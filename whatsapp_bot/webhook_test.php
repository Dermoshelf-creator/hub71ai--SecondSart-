<?php
/**
 * UltraMsg WhatsApp webhook - TEST SURUMU (yapay zeka yok). PHP 5 uyumlu.
 *
 *  - Kisi ilk mesajini atinca bot adini sorar.
 *  - Kisi bir sonraki mesajda adini yazinca "Memnun oldum, <ad>!" der.
 *  - Gelen her istek conversations/webhook.log dosyasina yazilir.
 *
 * Yapay zekali surum: webhook.php
 */

define('ULTRAMSG_INSTANCE', 'instance193236');
define('ULTRAMSG_TOKEN', 'iqhhm1nhskveiy8n');

define('CONVERSATIONS_DIR', dirname(__FILE__) . '/conversations');
define('LOG_FILE', CONVERSATIONS_DIR . '/webhook.log');

function log_line($msg)
{
    @file_put_contents(LOG_FILE, '[' . date('c') . '] ' . $msg . PHP_EOL, FILE_APPEND);
}

function get_value($array, $key, $default = null)
{
    return (is_array($array) && isset($array[$key])) ? $array[$key] : $default;
}

function send_whatsapp($to, $body)
{
    $ch = curl_init('https://api.ultramsg.com/' . ULTRAMSG_INSTANCE . '/messages/chat');
    curl_setopt_array($ch, array(
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query(array('token' => ULTRAMSG_TOKEN, 'to' => $to, 'body' => $body)),
        CURLOPT_HTTPHEADER     => array('Content-Type: application/x-www-form-urlencoded'),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT        => 30,
    ));
    $response = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    log_line('UltraMsg cevabi (' . $status . '): ' . ($response === false ? $error : $response));
}

if (!is_dir(CONVERSATIONS_DIR)) {
    @mkdir(CONVERSATIONS_DIR, 0775, true);
}

$raw     = file_get_contents('php://input');
$payload = json_decode($raw, true);
$data    = get_value($payload, 'data');

log_line('Gelen istek: ' . $raw);

header('HTTP/1.1 200 OK');
echo 'OK';

// Sadece bize gelen, birebir sohbetteki metin mesajlarini isle.
$from = (string) get_value($data, 'from', '');
$text = trim((string) get_value($data, 'body', ''));
if (
    !is_array($data)
    || get_value($payload, 'event_type') !== 'message_received'
    || get_value($data, 'fromMe')
    || get_value($data, 'type') !== 'chat'
    || substr($from, -5) === '@g.us'
    || $from === ''
    || $text === ''
) {
    exit;
}

// Kisiye adini sorduk mu? Basit bir dosya ile takip ediyoruz.
$stateFile = CONVERSATIONS_DIR . '/' . preg_replace('/[^0-9a-zA-Z]/', '_', $from) . '.test';

if (!file_exists($stateFile)) {
    file_put_contents($stateFile, 'asked');
    send_whatsapp($from, "Merhaba! Adınız nedir?");
} else {
    unlink($stateFile);
    send_whatsapp($from, "Memnun oldum, " . $text . "! Test başarılı.");
}
