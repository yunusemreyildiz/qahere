# QA Here (QA Rehber)

Jira'daki bir epic ya da task için, test etmeden önce okunacak **QA rehberini** otomatik hazırlar.
Jira işini ve alt işlerini, ilgili Slack konuşmalarını, Notion ve Confluence sayfalarını okur; sonucu tarayıcıda gösterir ve PDF olarak indirtir.

Rehberde şunlar bulunur: özelliğin özeti, kim hangi işte ve ne durumda, akış ve durum tablosu, servis kontratı ve hata kodları, ekran ekran test kontrol listesi, platform farkları, **kaynaklar arasındaki çelişkiler**, kronolojik kararlar, otomasyon id'leri, test hazırlığı ve "kime ne sorulmalı" listesi.

Araç kendi bilgisayarında çalışır. Yazıyı, bilgisayarında kurulu **Claude Code** üretir; ayrı bir API anahtarı ya da sunucu gerekmez, kendi Claude hesabının kullanım hakkından düşer.

Depoda hiçbir kuruma ait ayar ya da veri yoktur. Jira adresini, hesabını ve kaynaklarını ilk açılışta kendin girersin; hepsi yalnızca senin bilgisayarında saklanır.

---

## Kurulum

### 1. Gerekenler

| Ne | Neden | Kontrol |
| --- | --- | --- |
| Node.js 18 ya da üstü | Aracı çalıştırır | `node --version` |
| Claude Code | Rehberi yazar | `claude --version` |
| Chrome ya da Edge | PDF üretir (yoksa tarayıcıdan yazdırırsın) | – |
| Ücretli bir Claude hesabı | Claude Code'a giriş ve bağlantılar | – |

Node yoksa: <https://nodejs.org> (LTS sürümü).

### 2. Claude Code'u kur ve giriş yap

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Windows'ta PowerShell: `irm https://claude.ai/install.ps1 | iex`

Sonra terminalde bir kez çalıştır ve hesabınla giriş yap:

```bash
claude
```

### 3. Kaynak bağlantılarını aç

Rehberin Slack, Notion, Confluence ya da Claude Docs'ı okuyabilmesi için ilgili bağlantı Claude hesabında açık olmalı.

1. <https://claude.ai> → **Ayarlar → Bağlayıcılar (Connectors)**
2. Kullanacağın uygulamaları bağla (**Slack**, **Notion**, Confluence için **Atlassian**) ve izin ver.

Alternatif: terminalde `claude` açıkken `/mcp` yazıp aynı bağlantılara oradan giriş yapabilirsin.
Bazı çalışma alanlarında bağlantıyı önce yöneticinin onaylaması gerekir.

> Araç yalnızca **senin** görebildiğin içeriği okur. Üyesi olmadığın özel kanallar rehbere girmez.

### 4. Projeyi indir ve çalıştır

```bash
git clone https://github.com/yunusemreyildiz/qahere.git
```

```bash
cd qahere && npm install
```

```bash
npm start
```

Tarayıcıda aç: <http://localhost:4310>

### 5. İlk açılış adımları

İlk açılışta kısa bir kurulum ekranı gelir:

1. **Claude Code** kurulu mu, denetlenir.
2. **Jira'yı bağla:** Jira adresin (`sirketin.atlassian.net`), e-postan ve API token'ın. Token'ı <https://id.atlassian.com/manage-profile/security/api-tokens> sayfasından oluşturursun. "Bağlantıyı sına" görebildiğin projeleri listeler; listede görmek istediklerini seçersin.
3. **Kaynakları seç:** Slack, Notion, Confluence, Claude Docs. İstediğini aç, kapat.
4. **Ad ve renk:** İsteğe bağlı çalışma alanı adı ve vurgu rengi.

Jira token'ı **isteğe bağlıdır**. Token girmezsen epic listesi ve başlıkla arama çalışmaz; ama anahtarı (ör. `PROJ-123`) elle yazıp rehber üretebilirsin. O durumda Jira içeriğini Claude, Atlassian bağlantısıyla okur (biraz daha yavaş).

Her şeyi sonradan sağ üstteki **Ayarlar**'dan değiştirebilirsin.

Kurulumu komut satırından denetlemek istersen:

```bash
npm run doctor
```

---

## Kullanım

1. Soldaki listeden bir **epic** seç ya da üstteki kutuya anahtarı / Jira linkini / başlığı yazıp Enter'a bas.
2. İstersen **Ek not** yaz (ör. "hata durumlarına ağırlık ver").
3. **Rehber oluştur**'a bas. İlerleme satır satır görünür: hangi Jira işi, hangi arama, hangi sayfa okunuyor.
4. Bitince rehber sayfada açılır. **PDF indir** ile indir, **Yeni sekmede aç** ile tam ekran oku.
5. Üretilen her rehber **Rehberlerim** sekmesinde saklanır. Aynı iş için tekrar üretirsen eskileri "Önceki sürümler"de kalır.

Süre işin büyüklüğüne göre değişir; alt işi çok olan bir epic için birkaç dakika sürer.
Tek seferde bir rehber üretilir; ikincisi için ilkinin bitmesini bekle ya da **İptal** et.

Epic şart değil; tek bir task için de rehber üretebilirsin.

---

## Ayarlar

Ayarlar arayüzden yapılır ve `data/settings.json` dosyasında saklanır (git'e girmez).

| Ayar | Açıklama |
| --- | --- |
| Jira adresi, e-posta, API token | Liste, arama ve ön veri için. Adres değişirse token yeniden istenir. |
| Projeler | Soldaki listede görünecek Jira projeleri |
| Kaynaklar | Slack, Notion, Confluence, Claude Docs; kapalı olan kaynağa hiç bakılmaz |
| Çalışma alanı, vurgu rengi | Arayüzde ve rehber kapağında görünür |
| Model | `sonnet` dengeli, `opus` daha derin, `haiku` en hafif |

İstersen aynı değerleri `.env` dosyasıyla da verebilirsin (bkz. `.env.example`); arayüzden kaydedilen ayar önceliklidir. Yalnızca `.env` ile ayarlananlar:

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `CLAUDE_BIN` | `claude` | Komut PATH'te değilse tam yolu |
| `GENERATE_TIMEOUT_MIN` | `20` | Bir üretimin azami süresi |
| `PORT` | `4310` | Arayüz portu |
| `CHROME_BIN` | otomatik | PDF için tarayıcı yolu (bulunamazsa) |
| `CLAUDE_EXTRA_ALLOWED_TOOLS` | boş | Bağlantıların farklı adla kuruluysa ek okuma araçları |

### Kullanım maliyeti

Aracın kendisi ücretsizdir ve bir sunucuya bağlı değildir. Her rehber, onu üreten kişinin Claude hesabının kullanım hakkından düşer; ne kadar düşeceği işin büyüklüğüne ve seçilen modele bağlıdır.

---

## Rehberi kendine göre uyarlamak

- **İçerik ve bölümler:** `prompts/rehber.md`. Bölüm eklemek, sıra değiştirmek, araştırma kurallarını sıkılaştırmak için bu dosyayı düzenle. Sunucuyu yeniden başlatmaya gerek yok.
- **Görünüm:** `templates/guide.css`. Yazı boyutu, PDF sayfa kenarları. Vurgu rengi Ayarlar'dan gelir.
- **Kaynaklar:** `lib/generate.js` içindeki `READ_TOOLS`. **Yalnızca okuma araçları ekle.**

---

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| "Claude Code bulunamadı" | `claude --version` çalışıyor mu? Çalışmıyorsa 2. adımı tekrarla. Çalışıyor ama araç bulamıyorsa `.env`'e `CLAUDE_BIN=/tam/yol/claude` yaz (`which claude`). |
| "Jira'ya bağlanılamadı" | Ayarlar'da adresi, e-postayı ve token'ı kontrol edip "Bağlantıyı sına"ya bas. |
| Epic listesi boş | Ayarlar'da proje seçili mi? O projeyi görmeye yetkin var mı? |
| Rehberde bir kaynağa "bakılamadı" yazıyor | Sağ üstte **Durum → Bağlantıları denetle**. "Giriş gerekiyor" diyorsa 3. adımı tekrarla. |
| "Claude beklenen biçimde rehber üretmedi" | Tekrar dene. Sürerse `claude` komutunu terminalde açıp giriş yaptığından emin ol. |
| "Süre doldu" | Çok büyük epic. `GENERATE_TIMEOUT_MIN` değerini artır ya da alt işler için ayrı ayrı üret. |
| PDF inmiyor | Chrome/Edge kurulu değil. "Yeni sekmede aç" → tarayıcıdan Yazdır → PDF olarak kaydet. |
| Port dolu | `.env`'de `PORT=4311` yap. |

---

## Sınırlar

- Yalnızca **Jira Cloud** desteklenir (Jira Server / Data Center desteklenmez).
- Arayüz ve üretilen rehber **Türkçe**dir.
- Jira dışındaki iş takip araçları desteklenmez.

---

## Güvenlik ve gizlilik

- Sunucu yalnızca `127.0.0.1`'i dinler ve yalnızca bu bilgisayardaki tarayıcıdan gelen istekleri kabul eder.
- Claude'a yalnızca **okuma** araçları açılır. Mesaj gönderme, issue oluşturma ya da değiştirme, dosya yazma, komut çalıştırma ve web erişimi kapalıdır.
- Jira token'ı arayüze geri gönderilmez, yalnızca girdiğin Jira adresine gider; adres değişince silinir.
- Üretilen rehber betik çalıştıramayacak şekilde temizlenir ve korumalı çerçevede gösterilir.
- Ayarlar, token ve rehberler yalnızca senin bilgisayarında durur (`data/` ve `.env`; ikisi de git'e girmez).
- **Rehberi paylaşmadan önce oku.** İçinde senin erişebildiğin özel kanallardan alıntılar olabilir; paylaştığın kişinin o bilgiyi görmeye yetkisi olduğundan emin ol.
- Rehber otomatik derlenir; yanlış ya da eksik olabilir. Kritik maddeleri test etmeden önce ilgili kişiyle teyit et.

---

## Proje yapısı

```
qahere/
├── server.js            Express sunucusu, üretim işleri, arşiv, PDF uçları
├── lib/
│   ├── config.js        Ayarlar (data/settings.json + .env yedeği)
│   ├── jira.js          Jira REST istemcisi (yalnızca okuma)
│   ├── generate.js      Claude Code'u arka planda çalıştırır, çıktıyı temizler
│   ├── pdf.js           Chrome/Edge ile PDF
│   └── store.js         Rehber arşivi (data/guides)
├── prompts/rehber.md    Rehberin nasıl yazılacağını anlatan talimat
├── templates/guide.css  Rehberin görünümü
├── public/              Arayüz (bağımlılıksız HTML/CSS/JS)
└── data/                Ayarlar ve üretilen rehberler (git'e girmez)
```
