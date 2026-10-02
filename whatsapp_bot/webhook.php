<?php
/**
 * UltraMsg WhatsApp webhook -> ChatGPT bot. (PHP 5.4+ uyumlu, ek kutuphane gerekmez)
 *
 * Akis:
 *  1. UltraMsg gelen mesaji bu dosyaya POST eder (JSON).
 *  2. Kisi ile aktif bir konusma yoksa, bot sadece tetikleyici mesaj
 *     (index.html'deki "Hi Second Start — my partner just accepted a job...") gelince baslar.
 *  3. Konusma gecmisi + property_dump.json + jobs_with_commute_times.json ChatGPT'ye gonderilir; ChatGPT
 *     birkac soru sorup uygun is ilanlarini, sonra o ise yakin semt/kira onerisini yapar.
 *  4. Cevap UltraMsg /messages/chat API'si ile kisiye geri gonderilir.
 */

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------
define('ULTRAMSG_INSTANCE', 'instance193236');
define('ULTRAMSG_TOKEN', 'iqhhm1nhskveiy8n');

define('OPENAI_MODEL', 'gpt-5.5');
// Internette arastirma yapabilen model (basvuru icin gereken lisans/sertifika arastirmasi).
define('OPENAI_SEARCH_MODEL', 'gpt-5.5');
define('OPENAI_API_KEY', getenv('OPENAI_API_KEY') ? getenv('OPENAI_API_KEY') : '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');

// Konusmayi baslatan mesaj (index.html'deki hazir mesaj).
define('TRIGGER_TEXT', "Hi Second Start — my partner just accepted a job in Abu Dhabi and I'm looking for work. Can you help?");

// Bu kadar sure mesaj gelmezse konusma kapanir; yeniden tetikleyici gerekir.
define('CONVERSATION_TTL_SECONDS', 86400);
// ChatGPT'ye gonderilecek en fazla mesaj sayisi (eski mesajlar kirpilir).
define('MAX_HISTORY_MESSAGES', 40);
// En buyuk CV (PDF) boyutu.
define('MAX_CV_BYTES', 8 * 1024 * 1024);

define('PROPERTY_FILE', dirname(__FILE__) . '/property_dump.json');
define('JOBS_FILE', dirname(__FILE__) . '/jobs_with_commute_times.json');
define('CONVERSATIONS_DIR', dirname(__FILE__) . '/conversations');
// Log ve konusma dosyalari .php uzantili ve PHP_GUARD satiri ile baslar: tarayicidan acilsa bile icerigi gorunmez.
define('LOG_FILE', CONVERSATIONS_DIR . '/webhook.log.php');
define('PHP_GUARD', '<' . '?php exit; ?' . '>' . "\n");

// ---------------------------------------------------------------------------
// Yardimci fonksiyonlar
// ---------------------------------------------------------------------------
function log_line($msg)
{
    if (!file_exists(LOG_FILE)) {
        @file_put_contents(LOG_FILE, PHP_GUARD);
    }
    @file_put_contents(LOG_FILE, '[' . date('c') . '] ' . $msg . PHP_EOL, FILE_APPEND);
}

function get_value($array, $key, $default = null)
{
    return (is_array($array) && isset($array[$key])) ? $array[$key] : $default;
}

/** Karsilastirma icin metni sadelestirir: kucuk harf, Turkce karakter yok, noktalama yok. */
function normalize_text($text)
{
    $text = function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
    $text = strtr($text, array('ı' => 'i', 'ğ' => 'g', 'ü' => 'u', 'ş' => 's', 'ö' => 'o', 'ç' => 'c', 'â' => 'a', 'î' => 'i'));
    $text = preg_replace('/[^a-z0-9 ]+/', '', $text);
    return trim(preg_replace('/\s+/', ' ', $text));
}

function is_trigger($text)
{
    return strpos(normalize_text($text), normalize_text(TRIGGER_TEXT)) !== false;
}

function conversation_path($chatId)
{
    return CONVERSATIONS_DIR . '/' . preg_replace('/[^0-9a-zA-Z]/', '_', $chatId) . '.json.php';
}

/**
 * WhatsApp dosya mesajlarinda webhook bildirimi geldiginde dosya henuz yuklenmemis olabiliyor ("media" bos).
 * Dosya adresini birkac saniye arayla UltraMsg API'sinden mesajin kendisini okuyarak alir.
 * Not: UltraMsg buyuk listelerde (ornegin limit=20) "media" alanini gondermiyor; limit kucuk kalmali.
 */
function fetch_media_url($chatId, $messageId)
{
    $url = 'https://api.ultramsg.com/' . ULTRAMSG_INSTANCE . '/chats/messages?'
        . http_build_query(array('token' => ULTRAMSG_TOKEN, 'chatId' => $chatId, 'limit' => 5));

    for ($try = 0; $try < 6; $try++) {
        sleep(3);
        $messages = json_decode((string) http_get($url), true);
        if (!is_array($messages)) {
            continue;
        }
        foreach ($messages as $message) {
            if (get_value($message, 'id') === $messageId && get_value($message, 'media')) {
                return (string) get_value($message, 'media');
            }
        }
    }

    log_line('Dosya adresi UltraMsg API\'sinden alinamadi: ' . $messageId);
    return '';
}

/** curl ile POST atar; array('status' => int, 'body' => string|false, 'error' => string) doner. */
function http_post($url, $body, $headers)
{
    $ch = curl_init($url);
    $options = array(
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT        => 110,
    );
    if (defined('CURL_SSLVERSION_TLSv1_2')) {
        $options[CURLOPT_SSLVERSION] = CURL_SSLVERSION_TLSv1_2;
    }
    curl_setopt_array($ch, $options);
    $response = curl_exec($ch);
    $result = array(
        'status' => (int) curl_getinfo($ch, CURLINFO_HTTP_CODE),
        'body'   => $response,
        'error'  => curl_error($ch),
    );
    curl_close($ch);
    return $result;
}

function send_whatsapp($to, $body)
{
    $result = http_post(
        'https://api.ultramsg.com/' . ULTRAMSG_INSTANCE . '/messages/chat',
        http_build_query(array('token' => ULTRAMSG_TOKEN, 'to' => $to, 'body' => $body)),
        array('Content-Type: application/x-www-form-urlencoded')
    );

    if ($result['body'] === false || $result['status'] >= 400) {
        log_line('UltraMsg gonderim hatasi (' . $result['status'] . '): ' . ($result['error'] ? $result['error'] : $result['body']));
        return false;
    }
    return true;
}

/**
 * jobs_with_commute_times.json cok buyuk (~500 KB); yapay zekaya sadece gerekli alanlari
 * kisa satirlar halinde gonderiyoruz. Ulasim sureleri: sabah 08:00 evden ise / aksam 18:00 isten eve, dakika.
 */
function build_jobs_summary()
{
    $data = json_decode(file_get_contents(JOBS_FILE), true);
    $neighborhoods = get_value(get_value($data, 'routing_analysis', array()), 'neighborhoods', array());

    $lines = array();
    $lines[] = 'Each job lists "commute from <neighborhood>: morning/evening" in driving minutes '
        . '(morning = 08:00 from home to the job, evening = 18:00 from the job back home).';
    $lines[] = '';

    foreach (get_value($data, 'jobs', array()) as $job) {
        $start = get_value($job, 'start_timing');
        $fields = array(
            'id'         => get_value($job, 'id'),
            'category'   => get_value($job, 'category'),
            'title'      => get_value($job, 'title'),
            'employer'   => get_value($job, 'employer'),
            'area'       => get_value($job, 'area'),
            'deadline'   => get_value($job, 'deadline'),
            'employment' => get_value($job, 'employment_type'),
            'contract'   => get_value($job, 'contract_type'),
            'license'    => get_value($job, 'license_requirement')
                . (get_value($job, 'license_authority') ? ' (' . get_value($job, 'license_authority') . ')' : ''),
            'visa'       => get_value($job, 'visa_sponsorship'),
            'start'      => is_array($start) ? get_value($start, 'value') : $start,
            'apply'      => get_value($job, 'apply_url'),
        );

        $commutes = array();
        $byNeighborhood = get_value($job, 'commute_by_neighborhood', array());
        foreach ($neighborhoods as $name) {
            $routes  = get_value($byNeighborhood, $name, array());
            $morning = get_value($routes, 'morning_08_to_job', array());
            $evening = get_value($routes, 'evening_18_from_job', array());
            if (get_value($morning, 'status') === 'ok' && get_value($evening, 'status') === 'ok') {
                $commutes[] = $name . ' ' . round(get_value($morning, 'duration_minutes')) . '/' . round(get_value($evening, 'duration_minutes'));
            }
        }

        $parts = array();
        foreach ($fields as $key => $value) {
            if ($value !== null && $value !== '') {
                $parts[] = $key . ': ' . $value;
            }
        }
        $parts[] = $commutes ? 'commute from ' . implode(', ', $commutes) : 'commute: unknown (no exact address)';
        $lines[] = implode('; ', $parts);
    }

    return implode("\n", $lines);
}

function build_system_prompt()
{
    $properties = file_get_contents(PROPERTY_FILE);
    $jobs       = build_jobs_summary();
    $today      = date('Y-m-d');

    return <<<PROMPT
You are "Second Start", a friendly WhatsApp assistant for people whose partner has just accepted a job in Abu Dhabi
and who are now looking for work there themselves. You help them find a suitable job and, if needed, a neighborhood to live in.
The conversation usually opens with: "Hi Second Start — my partner just accepted a job in Abu Dhabi and I'm looking for work. Can you help?"

You have two databases below: current job openings (with driving commute times from each neighborhood) and approximate rents per neighborhood.

Language: always reply in English, even if the person writes in another language. You may still read and understand their messages
in any language.

Tone: always warm, polite and respectful. Thank them for their answers, and never sound pushy or robotic.
Ask one question per message (two only if they are very closely related) and keep messages short.

Follow these steps in order. Don't skip ahead; if the person already answered a later question earlier, don't ask it again.

1. Name: in your first reply, congratulate them on their partner's new job, say briefly that you'll help them find work in Abu Dhabi,
   and ask only for their name. Once they tell you, thank them and use their name now and then.
2. Profession and languages: ask what they do (profession, specialty, years of experience) and which languages they speak.
   Tell them that instead of typing, they can also simply send their CV as a PDF here.
   A CV arrives as a user message starting with "[CV PDF]" followed by its summary; use that information.
3. Confirmation: briefly sum up what you learned (profession, experience, languages) in a few short lines and ask them to confirm
   or correct it. Continue only after they confirm.
4. License: ask whether they hold the license their profession requires in Abu Dhabi.
   First check the license fields of matching jobs in the jobs database. If those are "unknown", use these Abu Dhabi rules:
   teachers need a teaching license from ADEK (Abu Dhabi Department of Education and Knowledge);
   doctors, nurses, dentists, therapists and other healthcare professionals need a DoH (Department of Health – Abu Dhabi) license.
   If their profession usually needs no license (e.g. marketing, communications, events), say so briefly and move on without asking.
   If they don't have the license yet, reassure them and note it may be needed before starting.
5. Visa: ask whether they have their own UAE visa / work permit, or whether they are coming on their partner's (family) visa.
6. Partner's employer: ask which company their partner will work for (and roughly where, if they know).
7. Housing: ask whether they have already rented their home in Abu Dhabi.
8. Follow exactly one of these two branches, based on their answer to step 7:
   - ALREADY RENTED (any yes-answer, e.g. "yes", "we rented", "we found a place"): ask only which area/neighborhood the home is in.
     In this branch NEVER ask about bedrooms or rent budget, and never recommend neighborhoods or rents later.
   - NOT RENTED YET: ask how many bedrooms they need and their annual rent budget in AED
     (if they give a monthly amount, convert it to annual).
   If their answer is unclear, ask again whether they have already rented, instead of guessing.
9. Commute: ask how many minutes at most they'd like their morning commute to work to take.
10. Results: as soon as step 9 is answered, give the results in that same reply (never "please wait, I'll check"),
    using only the databases:
    - 2-3 best matching jobs for their profession, experience and languages: *title*, employer, area, application deadline (if known)
      and the apply link. Prefer jobs whose morning commute fits their limit.
    - If they have already rented a home: give the morning/evening driving time to each job from their neighborhood
      (or the closest neighborhood in the database, and say it's the closest reference point).
      Do NOT recommend any neighborhoods or rents - they already have a home. Pick jobs that fit their commute limit from there.
    - If they haven't rented yet: recommend 2-3 neighborhoods that fit their bedrooms and budget and keep the morning commute to the
      recommended job within their limit: *neighborhood*, approximate annual rent range, morning/evening driving time.
      Where you can, prefer areas that are also reasonably placed for the partner's employer, but don't state minutes for the partner's
      commute (the database doesn't have them).
    - If nothing fits fully, say so honestly and show the closest options and what would need to change
      (commute time; and budget or bedrooms only in the NOT RENTED YET branch).
    Then offer to compare options or adjust the search.
11. Application help: after sending the results, ask whether they'd like help applying for one of these jobs.
    If yes (and it's clear which job), call the research_job_requirements tool to look up online the legal requirements,
    certifications and licenses needed to work in that job in Abu Dhabi, taking their visa and license situation into account.
    Then explain clearly and briefly what they need and the next steps, and include the most useful source links from the research.
    Only use the tool for this step; don't use it to find jobs, rents or commute times.

Rules:
- Only use jobs, neighborhoods, prices and commute times from the databases. Don't invent jobs, salaries, addresses or phone numbers.
- "unknown" in a job field means it hasn't been checked - say it's not confirmed, don't treat it as yes or no.
- Don't recommend jobs whose deadline has passed (today is {$today}).
- Mention once that commute times are driving estimates for a weekday (08:00 to work, 18:00 back home).
  When you show rents, also mention once that they are approximate annual asking rents (excluding deposit, agency fees and utilities).
- If the user sent something you can't read (a voice message, image or non-PDF file), politely ask them to type it or send their CV as a PDF.

WhatsApp style: short messages, plain text, *bold* for job titles and neighborhood names, simple "-" lists. No markdown headings or tables. Paste links as plain URLs.

<jobs_database>
{$jobs}
</jobs_database>

<rent_database>
{$properties}
</rent_database>
PROMPT;
}

/** OpenAI Chat Completions cagrisi; cevabin metnini ya da hata durumunda null doner. */
function openai_chat($messages)
{
    $message = openai_request(array('model' => OPENAI_MODEL, 'messages' => $messages));
    if ($message === null) {
        return null;
    }
    $text = trim((string) get_value($message, 'content', ''));
    return $text !== '' ? $text : null;
}

/** OpenAI Chat Completions istegi atar; cevaptaki 'message' dizisini ya da hata durumunda null doner. */
function openai_request($request)
{
    $result = http_post(
        'https://api.openai.com/v1/chat/completions',
        json_encode($request),
        array(
            'Content-Type: application/json',
            'Authorization: Bearer ' . OPENAI_API_KEY,
        )
    );

    if ($result['body'] === false) {
        log_line('OpenAI baglanti hatasi: ' . $result['error']);
        return null;
    }

    $response = json_decode($result['body'], true);
    if ($result['status'] >= 400 || !is_array($response)) {
        log_line('OpenAI API hatasi (' . $result['status'] . '): ' . substr($result['body'], 0, 1000));
        return null;
    }

    $choices = get_value($response, 'choices', array());
    $message = get_value(get_value($choices, 0, array()), 'message', array());

    if (get_value($message, 'refusal')) {
        log_line('OpenAI istegi reddetti: ' . get_value($message, 'refusal'));
        return null;
    }

    return $message;
}

/** Markdown'i WhatsApp bicimine cevirir: **kalin** -> *kalin*, [yazi](link) -> link, ### basliklar -> duz metin. */
function to_whatsapp_format($text)
{
    $text = str_replace('**', '*', $text);
    $text = preg_replace('/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/', '$1', $text);
    return preg_replace('/^#{1,6}\s*/m', '', $text);
}

/** Yapay zekanin internette arastirma yapmak icin cagirabilecegi arac. */
function research_tool_definition()
{
    return array(
        'type'     => 'function',
        'function' => array(
            'name'        => 'research_job_requirements',
            'description' => 'Search the web for the legal requirements, certifications and licenses needed to work in a specific job in Abu Dhabi, UAE. '
                . 'Use only when the user has asked for help applying to a specific job.',
            'parameters'  => array(
                'type'       => 'object',
                'properties' => array(
                    'job_title'       => array('type' => 'string', 'description' => 'Job title, e.g. "Primary Homeroom Teacher"'),
                    'employer'        => array('type' => 'string', 'description' => 'Employer name from the job listing'),
                    'profession'      => array('type' => 'string', 'description' => "The user's profession and specialty"),
                    'user_situation'  => array('type' => 'string', 'description' => "The user's visa status, current licenses and qualifications"),
                ),
                'required'   => array('job_title', 'employer', 'profession', 'user_situation'),
            ),
        ),
    );
}

/** research_job_requirements aracini calistirir: arama yapabilen modelle internette arastirir. */
function research_job_requirements($args)
{
    $question = 'I am applying for this job in Abu Dhabi, UAE: "' . get_value($args, 'job_title', '') . '" at '
        . get_value($args, 'employer', '') . '. My profession: ' . get_value($args, 'profession', '') . '. '
        . 'My situation: ' . get_value($args, 'user_situation', '') . ".\n"
        . 'Using current official sources (e.g. ADEK, DoH Abu Dhabi, MOHRE, ICP), list the legal requirements, '
        . 'professional licenses, certifications, document attestation and work permit / visa steps I need to work in this job in Abu Dhabi. '
        . 'Be concise and practical, and include the source URLs.';

    // Web aramasi OpenAI Responses API'sindeki web_search araciyla yapilir.
    $result = http_post(
        'https://api.openai.com/v1/responses',
        json_encode(array(
            'model' => OPENAI_SEARCH_MODEL,
            'tools' => array(array('type' => 'web_search')),
            'input' => $question,
        )),
        array(
            'Content-Type: application/json',
            'Authorization: Bearer ' . OPENAI_API_KEY,
        )
    );

    $text = '';
    $response = $result['body'] !== false ? json_decode($result['body'], true) : null;
    if ($result['status'] >= 400 || !is_array($response)) {
        log_line('Web arastirmasi hatasi (' . $result['status'] . '): '
            . ($result['body'] === false ? $result['error'] : substr($result['body'], 0, 1000)));
    } else {
        foreach (get_value($response, 'output', array()) as $item) {
            if (get_value($item, 'type') !== 'message') {
                continue;
            }
            foreach (get_value($item, 'content', array()) as $part) {
                if (get_value($part, 'type') === 'output_text') {
                    $text .= get_value($part, 'text', '');
                }
            }
        }
    }

    $text = trim($text);
    return $text !== '' ? $text : 'The web research failed. Give general guidance only and say it should be verified with the official authority.';
}

/** Her cevaptan hemen once modele verilen kisa hatirlatma. */
function turn_reminder()
{
    return "Before you reply, re-read the conversation and check which steps (1-11) are already answered. "
        . "Ask only the next unanswered step; never repeat a question that was already answered. "
        . "If the user said they have ALREADY RENTED a home, do not ask about bedrooms or rent budget, "
        . "and do not recommend neighborhoods or rents. "
        . "Never say you will look something up or ask them to wait: you can only answer when they write, "
        . "so when it's time for results, give the full results in this reply. Reply in English.";
}

/** Sohbet cevabi alir. $history: array(array('role' => 'user'|'assistant', 'content' => string), ...) */
function ask_ai($history)
{
    $messages = array_merge(
        array(array('role' => 'system', 'content' => build_system_prompt())),
        $history,
        // Uzun veritabaninin arkasinda kalan kurallari model unutmasin diye her cevaptan once kisa hatirlatma.
        array(array('role' => 'system', 'content' => turn_reminder()))
    );

    $message = openai_request(array(
        'model'    => OPENAI_MODEL,
        'messages' => $messages,
        'tools'    => array(research_tool_definition()),
    ));
    if ($message === null) {
        return null;
    }

    // Yapay zeka arastirma istediyse aramayi yap, sonucu verip son cevabi al.
    $toolCalls = get_value($message, 'tool_calls', array());
    if ($toolCalls) {
        $assistantCalls = array();
        $toolResults    = array();
        foreach ($toolCalls as $call) {
            $function = get_value($call, 'function', array());
            $args     = json_decode((string) get_value($function, 'arguments', '{}'), true);
            log_line('Internet arastirmasi: ' . get_value($function, 'arguments', ''));

            $assistantCalls[] = array(
                'id'       => get_value($call, 'id'),
                'type'     => 'function',
                'function' => array('name' => get_value($function, 'name'), 'arguments' => get_value($function, 'arguments', '{}')),
            );
            $toolResults[] = array(
                'role'         => 'tool',
                'tool_call_id' => get_value($call, 'id'),
                'content'      => get_value($function, 'name') === 'research_job_requirements'
                    ? research_job_requirements(is_array($args) ? $args : array())
                    : 'Unknown tool.',
            );
        }

        $messages[] = array('role' => 'assistant', 'content' => null, 'tool_calls' => $assistantCalls);
        $messages   = array_merge($messages, $toolResults);

        return openai_chat($messages);
    }

    $text = trim((string) get_value($message, 'content', ''));
    return $text !== '' ? $text : null;
}

/**
 * WhatsApp'tan gelen PDF CV'yi indirir ve yapay zekaya kisa bir ozetini cikartir.
 * Ozet sohbet gecmisine metin olarak eklenir; boylece PDF her mesajda tekrar gonderilmez.
 */
function summarize_cv($mediaUrl, $filename)
{
    $pdf = http_get($mediaUrl);
    if ($pdf === null) {
        return null;
    }
    if (substr($pdf, 0, 4) !== '%PDF') {
        log_line('Gelen dosya PDF degil: ' . $filename);
        return null;
    }
    if (strlen($pdf) > MAX_CV_BYTES) {
        log_line('CV cok buyuk: ' . strlen($pdf) . ' byte');
        return null;
    }

    return openai_chat(array(
        array('role' => 'user', 'content' => array(
            array('type' => 'file', 'file' => array(
                'filename'  => $filename !== '' ? $filename : 'cv.pdf',
                'file_data' => 'data:application/pdf;base64,' . base64_encode($pdf),
            )),
            array('type' => 'text', 'text' =>
                "This is a job seeker's CV. Summarize it in English in at most 8 short lines: profession and specialty, "
                . "total years of experience, most recent roles, education, languages spoken, professional licenses or certifications, "
                . "and any other detail relevant to finding a job. Write only what the CV says; if something isn't in it, say \"not stated\"."),
        )),
    ));
}

/** Basit GET; icerigi ya da hata durumunda null doner. */
function http_get($url)
{
    $ch = curl_init($url);
    $options = array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT        => 60,
    );
    if (defined('CURL_SSLVERSION_TLSv1_2')) {
        $options[CURLOPT_SSLVERSION] = CURL_SSLVERSION_TLSv1_2;
    }
    curl_setopt_array($ch, $options);
    $body   = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error  = curl_error($ch);
    curl_close($ch);

    if ($body === false || $status >= 400) {
        log_line('Dosya indirilemedi (' . $status . '): ' . $url . ' ' . $error);
        return null;
    }
    return $body;
}

// ---------------------------------------------------------------------------
// Webhook girisi
// ---------------------------------------------------------------------------
if (!is_dir(CONVERSATIONS_DIR)) {
    @mkdir(CONVERSATIONS_DIR, 0775, true);
}

$payload = json_decode(file_get_contents('php://input'), true);
$data    = get_value($payload, 'data');

// UltraMsg'ye hemen 200 don; islem arka planda devam etsin (tekrar denemeleri onler).
header('HTTP/1.1 200 OK');
echo 'OK';
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
}
ignore_user_abort(true);
@set_time_limit(300);

// Sadece bize gelen, birebir sohbetteki mesajlari isle.
$from = (string) get_value($data, 'from', '');
$type = (string) get_value($data, 'type', '');
$text = trim((string) get_value($data, 'body', ''));
if (
    !is_array($data)
    || get_value($payload, 'event_type') !== 'message_received'
    || get_value($data, 'fromMe')
    || substr($from, -5) === '@g.us'
    || $from === ''
    || ($type === 'chat' && $text === '')
) {
    exit;
}

$chatId    = $from;
$messageId = (string) get_value($data, 'id', '');

// Ayni kisiden eszamanli gelen mesajlar birbirini ezmesin diye dosyayi kilitle.
$fp = fopen(conversation_path($chatId), 'c+');
if ($fp === false) {
    log_line('Konusma dosyasi acilamadi: ' . conversation_path($chatId));
    exit;
}
flock($fp, LOCK_EX);
$stored = stream_get_contents($fp);
if (strpos($stored, PHP_GUARD) === 0) {
    $stored = substr($stored, strlen(PHP_GUARD));
}
$conversation = json_decode($stored, true);

$expired = !is_array($conversation)
    || (time() - get_value($conversation, 'updated_at', 0)) > CONVERSATION_TTL_SECONDS;

if ($expired) {
    if ($type !== 'chat' || !is_trigger($text)) {
        // Aktif konusma yok ve tetikleyici gelmedi: bot sessiz kalir.
        flock($fp, LOCK_UN);
        fclose($fp);
        exit;
    }
    $conversation = array('messages' => array(), 'seen_ids' => array());
}

// Ayni mesaj ikinci kez gelirse tekrar cevap verme.
if ($messageId !== '' && in_array($messageId, $conversation['seen_ids'], true)) {
    flock($fp, LOCK_UN);
    fclose($fp);
    exit;
}
$conversation['seen_ids'][] = $messageId;
$conversation['seen_ids'] = array_slice($conversation['seen_ids'], -50);

// Mesaji yapay zekanin okuyabilecegi metne cevir.
if ($type === 'chat') {
    $userContent = $text;
} elseif ($type === 'document') {
    $filename = (string) get_value($data, 'filename', $text);
    $mediaUrl = (string) get_value($data, 'media', '');
    if ($mediaUrl === '') {
        $mediaUrl = fetch_media_url($chatId, $messageId);
    }
    $cv = $mediaUrl !== '' ? summarize_cv($mediaUrl, $filename) : null;
    if ($cv !== null) {
        $userContent = "[CV PDF] The user sent their CV. Summary:\n" . $cv;
    } else {
        $userContent = '[The user sent a file (' . $filename . ") that could not be read as a PDF CV.]";
    }
} else {
    $userContent = '[The user sent a ' . $type . ' message, which cannot be read.]';
}

$conversation['messages'][] = array('role' => 'user', 'content' => $userContent);

// Gecmisi kirp; ilk mesaj her zaman 'user' olsun.
$history = array_slice($conversation['messages'], -MAX_HISTORY_MESSAGES);
while ($history && $history[0]['role'] !== 'user') {
    array_shift($history);
}

$reply = ask_ai($history);

if ($reply === null) {
    $reply = "Sorry, I'm having a technical issue right now. Please try again in a moment.";
    // Basarisiz turu gecmise ekleme.
    array_pop($conversation['messages']);
} else {
    $reply = to_whatsapp_format($reply);
    $conversation['messages'][] = array('role' => 'assistant', 'content' => $reply);
}

$conversation['updated_at'] = time();
ftruncate($fp, 0);
rewind($fp);
fwrite($fp, PHP_GUARD . json_encode($conversation));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

send_whatsapp($chatId, $reply);
