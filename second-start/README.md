# Second Start · Hub71 AI Hackathon

Abu Dhabi’ye taşınan ailede ikinci kariyeri, ev seçimini ve günlük ulaşımı birlikte düşünmeye yardımcı olan çalışan MVP.

**Bu paket: Next.js 16 + React + Vercel + Supabase PostgreSQL.** QR kodla açılan web sitesi giriş istemez. Profil cevapları sunucu API’sinden Supabase’e kaydedilir. OpenAI Responses API doğal cümleleri mevcut sorunun yapılandırılmış cevabına dönüştürür. Semt ve iş önerileri kaynaklı dataset ve hesaplanan kurallardan gelir.

**Canlı kuruluma başlamak için:** [adım adım Vercel + Supabase rehberi](docs/VERCEL_SUPABASE_SETUP.md).

## Akış

Ev bulundu mu? → meslek ve uzmanlık → gerekiyorsa lisans → vize → çalışma biçimi → başlangıç → günlük saatler → kesin saat koşulu → ulaşım tercihi.

- Ev bulunduysa mevcut semt seçilir, iş listesi açılır.
- Ev aranıyorsa partner adresi isteğe bağlı alınır, 1/2/3 BHK ve yıllık bütçe sorulur, 10 semt karşılaştırılır. Bir semt seçilince potansiyel işler açılır.
- Sarah örneği hızlı demo sağlar; bu kısayol OpenAI çağrısı yapmaz. Gerçek AI demosu için saat sorusunda doğal bir cümle kullan.

## Veritabanı

| Supabase tablosu | İçerik |
| --- | --- |
| `second_start_jobs` | 60 ilan; meslek, uzmanlık, kaynak, iki yönlü ulaşım verisi |
| `second_start_neighborhoods` | 10 semt; 1/2/3 BHK yıllık AED kira aralıkları ve kaynaklar |
| `second_start_candidates` | Ziyaretçinin cevapları, mevcut adımı, seçtiği semt, revision |
| `second_start_events` | Tekrar gelen isteklerin kayıtlı cevapları; süreli partner rota önbelleği |
| `second_start_metadata` | Dataset sürümü ve kaynak bilgileri |

Tek seferlik `supabase/migrations/202610020001_second_start.sql` şemayı ve fonksiyonları kurar. Yeni sürümde boş veritabanına 60 ilan ve 10 semt ilk uygulama/health isteğinde otomatik yüklenir. İstersen `supabase/bootstrap.sql` ile şema ve veriyi SQL Editor’da birlikte de yükleyebilirsin. Migration tekrar uygulanabilir; aynı dataset sürümü tekrar yüklenmez. Profil güncellemesi ve tekrar kaydı tek SQL fonksiyonunda atomik kaydedilir. RLS açıktır; `anon`/`authenticated` rolleri tablolara ve uygulama fonksiyonlarına erişemez. Sunucu anahtarı yalnızca Next.js API’de kullanılır.

Web oturumu 7 günlük HttpOnly/SameSite çerezle devam eder; farklı tarayıcı yeni anonim profil açar. Giriş veya Supabase Auth kurulumu bu MVP’de gerekmez. Telefon WhatsApp ve web ayrı profil kimlikleri kullanır; otomatik hesap birleştirme yoktur.

## Anahtarlar

Vercel’de server environment variables:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=your-server-secret-key
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4.1-mini
```

Gerçek anahtarları bu örneklere, GitHub’a veya sohbet mesajına yazma; Vercel’in paneline gir. Yeni Supabase `sb_secret_...` anahtarı önerilir; eski proje için `SUPABASE_SERVICE_ROLE_KEY` alternatifi desteklenir. `anon`/publishable anahtar bu sunucu bağlantısı için yetkili değildir. Hiçbir değişkene `NEXT_PUBLIC_` ekleme.

`/api/health`: gerçek Supabase okumaları başarılıysa `status=ok`, `jobs=60`, `neighborhoods=10`. `openaiConfigured=true` sadece anahtarın varlığını gösterir; gerçek AI çağrısını doğal cevapla ayrıca dene.

## Yerel geliştirme ve doğrulama

Node.js 24 kullan:

```bash
npx pnpm@11.25.0 install --frozen-lockfile
cp .env.example .env.local
npx pnpm@11.25.0 dev
```

Supabase bootstrap’ı önce uygula; `.env.local` değerlerini kendi bilgisayarında doldur. Dosya gitignore içindedir. Yerel ortamda da aynı Supabase kullanılır; demo adaylarını izole etmek için ayrı proje kullanabilirsin.

```bash
npx pnpm@11.25.0 test
npx pnpm@11.25.0 typecheck
npx pnpm@11.25.0 lint
npx pnpm@11.25.0 build
npx pnpm@11.25.0 test:integration
```

13 eşleştirme testi + üretim Next.js sunucusuna gerçek HTTP istekleriyle SQL/persistence/isolation/idempotence testleri. Entegrasyon testi PostgreSQL’i PGlite ile yerelde çalıştırır; Supabase HTTP taşımasını ve OpenAI cevabını taklit eder. Gerçek hesaplara bağlanmaz ve gerçek AI erişimini doğrulamaz.

## Veri ve sınırlar

- `data/jobs_with_commute_times.json`: 60 küratörlü ilan; kaynak ilan bağlantıları ve eksikler korunur.
- `data/property_dump.json`: 10 semt × 1/2/3 BHK; yaklaşık yıllık kira bantları, kaynak ve güven bilgileri. Bunlar canlı mülk envanteri veya istatistiksel scrape sonucu değildir.
- Ulaşım join’i `job.commute_by_neighborhood[neighborhood.commute_key]`. 08:00 evden işe ve 18:00 işten eve ayrılış snapshot’ı kullanılır; 08:00 varış veya 15:00 dönüş olarak sunulmaz.
- 53 adresli ve 7 adresi eksik ilan: 1,060 kullanılabilir rota alanı, 140 adresi eksik alan. Eksik süre `null`; sıfır olmaz.
- İş saatleri ve lisans bilgisi çoğunlukla bilinmiyor. Sistem kesin uygunluk uydurmaz; işverenle kontrol edilmesi gerekenleri gösterir.
- Gate/Bloom 1/2 BHK için yakındaki Rabdan verisi proxy olarak açıkça işaretlenir; 3 BHK townhouse/villa kapsamındadır.
- Veri kaynağı güncellemesi şu an manueldir. JSON’ları düzelt, sabit ID ve commute key’lerini koru; `npx pnpm@11.25.0 db:seed:sql` çalıştır ve Supabase’de yeni `supabase/seed.sql` uygula. Dataset yeniden okunurken en fazla 60 saniyelik sunucu önbelleği vardır. Otomatik ilan/emlak çekme henüz bağlı değildir.

## İsteğe bağlı bağlantılar

Ana QR/web deneyimi için Twilio veya Google Maps gerekmez.

- Gerçek WhatsApp için `TWILIO_AUTH_TOKEN` ve tam `WHATSAPP_WEBHOOK_URL=https://PUBLIC_DOMAIN/api/whatsapp` değerlerini Vercel’e ekle, yeniden deploy et; Twilio Sandbox inbound webhook’unda aynı URL ve POST seç. Kullanıcı sandbox’a katılır. İmza doğrulaması ve MessageSid retry kontrolü çalışır. Üretim WhatsApp numarası/provisioning ayrıca gerekir.
- Partnerin yeni ulaşım hesapları için `GOOGLE_MAPS_API_KEY` ekle. Google Routes API erişimi gerekir. Adres Google’a gönderilir; sonuçlar referans noktalarına aittir. Ana job rota dataset’i bu anahtar olmadan çalışır.

## Hub71 teslim

Yeni GitHub repo: `hub71ai-[team-name]`. Vercel’de bu repo ve `main` production branch’i seç. Jüriye takım adı, track, repo, gerçek final SHA, production URL ve giriş talimatını ver. Hedef: 15:15 canlı, 15:30 commit/push/submit, 15:45 Dubai hard freeze. Final submit’ten sonra değerlendirilen kodu, promptu, UI’yı veya modeli değiştirme. [3 dakika demo metni](docs/DEMO_3_MINUTES.txt), [teslim alanları](docs/HUB71_SUBMISSION.txt).

Bu kaynak paketi teslim edilmek üzere hazırlanmıştır; kendi başına GitHub submission veya canlı Vercel deployment anlamına gelmez.
