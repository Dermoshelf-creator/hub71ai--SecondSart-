<?php
/**
 * GECICI TESHIS DOSYASI - PDF sorununu bulduktan sonra sunucudan SILIN.
 * Sunucunun, webhook'un PDF icin yaptigi adimlari yapip yapamadigini test eder.
 * Sadece durum bilgisi yazar; mesaj veya dosya icerigi gostermez.
 * Kullanim: diag.php?key=sstart-7f3k
 */
if (!isset($_GET['key']) || $_GET['key'] !== 'sstart-7f3k') {
    header('HTTP/1.1 404 Not Found');
    exit;
}
header('Content-Type: text/plain; charset=utf-8');

$token  = 'iqhhm1nhskveiy8n';
$chatId = '971586083664@c.us';

function get_url($url)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT        => 60,
    ));
    $body = curl_exec($ch);
    $info = array(
        'status' => curl_getinfo($ch, CURLINFO_HTTP_CODE),
        'errno'  => curl_errno($ch),
        'error'  => curl_error($ch),
        'bytes'  => $body === false ? 0 : strlen($body),
    );
    curl_close($ch);
    return array($body, $info);
}

$curl = curl_version();
echo "PHP: " . PHP_VERSION . "\n";
echo "curl: " . $curl['version'] . " / SSL: " . $curl['ssl_version'] . "\n";
echo "TLS 1.2 sabiti: " . (defined('CURL_SSLVERSION_TLSv1_2') ? 'var' : 'yok') . "\n\n";

echo "1) UltraMsg API'den mesaj listesi\n";
list($body, $info) = get_url('https://api.ultramsg.com/instance193236/chats/messages?'
    . http_build_query(array('token' => $token, 'chatId' => $chatId, 'limit' => 5)));
echo "   " . json_encode($info) . "\n";
$media = '';
$messages = json_decode((string) $body, true);
if (is_array($messages)) {
    foreach ($messages as $m) {
        if (isset($m['type'], $m['media']) && $m['type'] === 'document' && $m['media']) {
            $media = $m['media'];
        }
    }
}
echo "   PDF adresi bulundu mu: " . ($media ? 'evet' : 'hayir') . "\n\n";

if ($media) {
    echo "2) PDF'i Amazon S3'ten indirme\n";
    list($pdf, $info) = get_url($media);
    echo "   " . json_encode($info) . "\n";
    echo "   PDF mi: " . ($pdf !== false && substr($pdf, 0, 4) === '%PDF' ? 'evet' : 'hayir') . "\n\n";
}

echo "3) Log dosyasindaki son hata satirlari\n";
$log = @file(dirname(__FILE__) . '/conversations/webhook.log.php');
if ($log) {
    $errors = array();
    foreach ($log as $line) {
        if (preg_match('/hata|indirilemedi|alinamadi|PDF degil|buyuk|reddetti/i', $line)) {
            $errors[] = substr(preg_replace('/token=[^&\s]+/', 'token=***', $line), 0, 600);
        }
    }
    echo $errors ? '   ' . implode('   ', array_slice($errors, -10)) : "   hata satiri yok\n";
} else {
    echo "   log dosyasi yok ya da okunamadi\n";
}
