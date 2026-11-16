1. **Özet kutusu** (`box brand`): özellik 3–5 cümlede ne, ve QA için ana kural ne.
2. **Durum** : `kpis` ile 3–4 sayı (iş sayısı, durum dağılımı, hedef sürüm gibi) ve bir `box ok` içinde "nerede, ne durumda" (hangi platform hangi aşamada, test edilebilir build var mı, canlıya çıkan parça var mı).
3. **Akış ve durumlar**: numaralı adımlar; sistemin durumlarına göre "ne gelirse ne olur" tablosu.
4. **İş haritası** *(detay)*: tablo; her alt iş için anahtar, kim, durum etiketi, kapsam.
5. **Servis / kontrat** *(detay)* (varsa): uç noktalar, istek-yanıt kuralları, hata kodları ve her birinde beklenen davranış, sonradan yapılan kontrat değişiklikleri.
6. **Test kontrol listesi**: ekran ya da iş bazında alt başlıklar, her biri `ul class="chk"`.
7. **Platform farkları** (varsa): iOS / Android / web tablosu.
8. **Çelişkiler ve belirsizlikler**: `box bad` içinde çözülmemiş çelişkiler (her birinde: iki tarafın ne dediği + nasıl test edileceği), `box warn` içinde işlerde açık kalan sorular.
9. **Kararlar (kronolojik)** *(detay)*: tablo; tarih, karar, kim ve nerede.
10. **Otomasyon ve analytics** *(detay)* (varsa): erişilebilirlik / test id'leri tablosu, event listesi ve dikkat edilecekler.
11. **Test hazırlığı**: gerekli kullanıcı/veri durumları, ortam, araçlar.
12. **Kime ne sorulmalı** *(detay)*: tablo; soru ve muhtemel muhatap.
13. **Kaynaklar** *(detay)*: okunan Jira işleri, yazışmalar (kanal/thread), doküman sayfaları, dosyalar. Ardından **Bakılamayanlar**.
