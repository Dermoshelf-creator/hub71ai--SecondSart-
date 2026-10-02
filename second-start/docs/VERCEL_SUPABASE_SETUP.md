# Second Start — Vercel + Supabase kurulumu

Öncelik: QR → herkese açık web sitesi → soldaki sohbet (telefonda üstte) → semt/iş karşılaştırması. Twilio web deneyimi için gerekli değildir.

## 1. Supabase projesi ve veriler

1. https://supabase.com/dashboard adresinde **New project** seç. Proje adı `second-start`. Veritabanı şifresini kendinde sakla; uygulama şifreye veya doğrudan PostgreSQL bağlantısına ihtiyaç duymaz.
2. Proje hazır olunca **SQL Editor → New query** aç.
3. Paketteki **`supabase/migrations/202610020001_second_start.sql` dosyasının tamamını** (sohbetteki şema query’si) yapıştır ve **Run** seç. JSON’ları Table Editor’a yüklemen gerekmez; yeni uygulama sürümü boş veritabanına verileri ilk açılışta otomatik aktarır.
4. Aşağıdaki kontrolü ayrı sorgu olarak çalıştır:

```sql
select
  (select count(*) from public.second_start_jobs) as jobs,
  (select count(*) from public.second_start_neighborhoods) as neighborhoods;
```

Yalnızca şemayı çalıştırdıysan deploy öncesi `0 / 0` normaldir. Vercel’de yeni sürümü deploy edip `/api/health` açınca beklenen `jobs=60`, `neighborhoods=10` olur. Tam bootstrap SQL kullandıysan veriler hemen görünür.

5. Projenin **Connect** bölümünden Project URL’i al. **Settings → API Keys** bölümünden server için **Secret key** (`sb_secret_...`) oluştur/al. Eski projede legacy `service_role` anahtarı alternatif olarak kullanılabilir. Publishable/anon key bu kurulumda kullanılmaz.

Yalnızca uygulamaya ait `second_start_...` tabloları açılır. RLS/grants bootstrap’ın içindedir; herkese açık tablo politikası ekleme.

## 2. GitHub’a doğru kaynak sürümü

https://github.com/new adresinde hackathon için **yeni ve boş** repo aç: `hub71ai-[team-name]`. README/license/.gitignore kutularını ekleme.

Aşağıdaki `secondstart` örnek takım adıdır; kendi kayıtlı adınla ve hesabınla değiştir. Bundle dosyası kodun commit geçmişini ve SHA’sını korur:

```bash
git clone second-start-vercel-supabase.bundle hub71ai-secondstart
cd hub71ai-secondstart
git remote remove origin
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/hub71ai-secondstart.git
git push -u origin main
git rev-parse HEAD
```

Bundle yerine ZIP kullanırsan ZIP’i aç, kaynak köküne gir (`package.json` bu klasörde olmalı) ve:

```bash
git init
git add .
git commit -m "Build Second Start with Vercel and Supabase"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/hub71ai-secondstart.git
git push -u origin main
git rev-parse HEAD
```

ZIP yolu yeni SHA üretir. Teslimde kendi GitHub SHA’nı ve Vercel’de deploy edilen aynı commit’i kullan. `.env.local` / anahtarları asla commit etme.

## 3. Vercel deployment

1. https://vercel.com/new → **Import Git Repository**. Yeni hackathon repo’sunu seç; GitHub bağlantısı gerekiyorsa kendi hesabında tamamla.
2. Framework **Next.js**, Root Directory kaynak kökü (`./`), Node.js **24.x**. `vercel.json` kurulum/derleme komutlarını sabitlemiştir; Cloudflare/Vinext komutu kullanma.
3. **Environment Variables** bölümüne aşağıdaki dört değeri ekle. Gerçek anahtarları sohbet veya kaynak dosyasına yazmadan doğrudan Vercel’e gir.

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SECRET_KEY` | Supabase `sb_secret_...` server key |
| `OPENAI_API_KEY` | OpenAI Platform API key |
| `OPENAI_MODEL` | `gpt-4.1-mini` |

Eski `service_role` kullanıyorsan ikinci satırı **`SUPABASE_SERVICE_ROLE_KEY`** adıyla ekle. İki Supabase key değişkenini birlikte eklemene gerek yok. Değişkenleri Production’a uygula; Preview da kullanacaksan Preview’ya da ekle. `NEXT_PUBLIC_` prefix’i ekleme.

4. **Deploy** seç. İlk yayın tamamlanınca Vercel’in verdiği gerçek **production URL**’i kullan. Kod GitHub’da; profile/data kayıtları Supabase’de; OpenAI çağrısı Vercel sunucusunda çalışır.
5. **Settings → Deployment Protection** altında production domain’inin ziyaretçiden Vercel login istemediğini doğrula. Preview URL yerine production domain’i QR’a koy. Production koruması açıksa public demo isteği doğrultusunda kapat.
6. Değişkenleri deploy’dan sonra eklersen **Redeploy** gerekir. Deadline öncesinde yap; final submit’ten sonra yeni kod/prompt/model değişikliği yapma.

## 4. Gerçek bağlantıyı test et

- Telefonda gizli sekmeyle ve mümkünse mobil internetten production URL’i aç. Giriş ekranı olmamalı.
- `https://YOUR_PRODUCTION_DOMAIN/api/health` içinde `status=ok`, `database=connected`, `jobs=60`, `neighborhoods=10`, `openaiConfigured=true` gör. WhatsApp/partner false olabilir; web akışını engellemez.
- Yeni bir profil oluştur, birkaç cevaptan sonra sayfayı yenile: cevapların devam etmeli.
- İkinci gizli tarayıcıda yeni profil açılmalı; başka ziyaretçinin cevapları görünmemeli.
- Saat sorusunda **“I can start at eight, but I need to finish by three for school pickup.”** yaz. Sonuçta **08:00–15:00** ve **“Answer interpreted with OpenAI”** görünmeli. API key yok/erişim başarısızsa bunun çalıştığını iddia etme. Sarah kısayolu AI çağrısını test etmez.
- Sarah örneğini veya kendi cevaplarını tamamla; Khalifa City → View jobs; kira, iki yön sürüş ve employer hours kontrol notlarını göster.

## 5. QR ve teslim

Production URL kesinleşince QR’ı **o gerçek URL** için üret. Sites’in özel URL’ine veya Vercel preview linkine QR üretme. Telefondan baştan sona dene; jüriye aynı linki ver.

`docs/HUB71_SUBMISSION.txt` alanlarını kendi bilgilerinle teslim formuna doldur. GitHub repo SHA’sı Vercel deployment’ın commit’iyle aynı olmalı. Bu taslak dosyayı doldurup GitHub’a kaydedersen yeni commit/SHA oluşur; o son commit’i deploy ederek tekrar kaydet.

**15:15** yayın çalışsın · **15:30** commit/push/submit · **15:45 Dubai** mutlak code freeze. Üç dakikada tek yolculuk, slayt yok. Final submission’dan sonra değerlendirilen sürüme dokunma.

## Sorun çıkarsa

| Belirti | Kontrol |
| --- | --- |
| `/api/health` 503 | Doğru Project URL/key, bootstrap SQL uygulanmış mı, Supabase proje hazır mı? |
| Tablo dolu ama profil açılmıyor | Secret/service_role key kullanılmış mı; anon/publishable kullanılmamalı |
| Sohbet var ama AI etiketi değişmiyor | Doğal cümle kullan; OpenAI key/account erişimi ve API kredilerini kontrol et |
| Login ekranı çıkıyor | Production URL ve Deployment Protection ayarı |
| Değişken eklendi ama hâlâ eski davranış | Production environment ve Redeploy |
| GitHub/Vercel SHA farklı | `main` production branch ve deployment source commit |

## Resmî kaynaklar

- Supabase SQL Editor/tables: https://supabase.com/docs/guides/database/tables
- Supabase server keys: https://supabase.com/docs/guides/getting-started/api-keys
- Database functions/grants: https://supabase.com/docs/guides/database/functions
- Vercel Git deployment: https://vercel.com/docs/git
- Vercel environment variables: https://vercel.com/docs/environment-variables
- Vercel deployment protection: https://vercel.com/docs/deployment-protection
- Node 24: https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- OpenAI API setup: https://developers.openai.com/api/docs/quickstart
