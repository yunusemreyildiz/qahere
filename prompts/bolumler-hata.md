Bu bir **hata kaydı**. Rehber özellik anlatmaz; hatanın yeniden üretilmesine, düzeltmenin doğrulanmasına ve düzeltmenin bozmuş olabileceği komşu akışlara odaklanır. Kısa tut: okuyan kişi 2–3 dakikada test etmeye başlayabilmeli.

1. **Özet kutusu** (`box brand`): hata 2–3 cümlede ne, nerede, kimi etkiliyor; düzeltme yapıldı mı ve test edilebilir mi.
2. **Durum**: `kpis` ile 3–4 sayı/etiket (öncelik, durum, platform, hedef sürüm) ve bir `box ok` içinde düzeltmenin nerede olduğu (hangi build/sürüm, hangi platform; bilinmiyorsa "kaynaklarda yok").
3. **Yeniden üretme**: ön koşullar (kullanıcı, veri, ortam), numaralı adımlar; ardından `grid2` içinde "Beklenen" ve "Gerçekleşen". Kayıtta adım yoksa yorumlardan çıkar, hiç yoksa açıkça yaz.
4. **Test kontrol listesi**: iki alt başlık, her biri `ul class="chk"`:
   - "Düzeltmenin doğrulanması": hatanın artık oluşmadığı, aynı adımlarla ve uç durumlarla (boş/çok uzun değer, bağlantı kopması, tekrar deneme).
   - "Regresyon": düzeltmenin dokunduğu ekran, servis ya da bileşenle bağlantılı komşu akışlar. Yalnızca kaynaklarda dayanağı olanları yaz; tahmin ettiğin riskleri ayrı bir "Öneriler" kutusunda topla.
5. **Platform farkları** (varsa): hatanın hangi platformda/sürümde görüldüğü, diğerinde de kontrol edilmesi gerekip gerekmediği.
6. **Çelişkiler ve belirsizlikler**: `box bad` / `box warn`; ör. adımlar yorumlarla uyuşmuyor, düzeltme kapsamı belirsiz.
7. **Kök neden ve düzeltme** *(detay)* (varsa): geliştiricinin yazdığı neden, değişen yer, ilgili PR ya da yorum.
8. **Bağlı işler** *(detay)* (varsa): tablo; story, kopya ya da ilişkili hatalar, durum etiketiyle.
9. **Otomasyon** *(detay)* (varsa): ilgili erişilebilirlik / test id'leri.
10. **Kime ne sorulmalı** *(detay)*: tablo; soru ve muhtemel muhatap.
11. **Kaynaklar** *(detay)*: okunan Jira işleri, yazışmalar, dokümanlar. Ardından **Bakılamayanlar**.
