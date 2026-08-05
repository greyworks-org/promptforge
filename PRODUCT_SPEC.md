# PromptForge Local — Ürün Spesifikasyonu

> **Format notu:** Bu dosyanın orijinali RTF biçiminde yazılmıştı ve `PRODUCT_SPEC.md`
> adı altında saklanıyordu. Orijinal bayt-baytına `PRODUCT_SPEC.original.rtf` olarak
> korunmuştur. Bu dosya, içeriğin birebir Markdown dönüşümüdür (metin değiştirilmemiştir).
> Uygulama açısından bağlayıcı mühendislik kaynakları `docs/` klasöründeki belgelerdir.

## Net ürün kararı

Ayrı ve lokal çalışan bir "AI Development Prompt Compiler" geliştirelim.
Çalışma adı: **PromptForge Local**

Bu ürünün görevi promptu daha uzun veya daha profesyonel göstermek olmayacak. Ham talebini:

- Seçili projenin mevcut durumuna göre anlayacak
- Eksik veya çelişkili noktaları tespit edecek
- Gereksiz bağlamı ayıklayacak
- Uygulanabilir görev tanımına çevirecek
- Aynı görevi Qwen Code, Codex veya Claude Code için ayrı biçimde hazırlayacak
- Sonuçları ölçerek hangi prompt yapısının daha başarılı olduğunu öğrenecek

Ana geliştirme aracı Qwen Code olacak. Codex ve Claude, Qwen kotası bittiğinde veya belirli işlerde ikinci seçenek olarak kullanılacak. PromptForge'un kendi AI motoru ise elinizdeki DeepSeek Flash API olacak.

Bir teknik not: Model adı kodda sabitlenmemeli. DeepSeek'in güncel resmî model listesinde `deepseek-v4-flash` bulunuyor. Sizdeki servis bunu "DeepSeek V2 Flash" şeklinde adlandırıyorsa `baseUrl`, `apiKey` ve `modelId` tamamen ayarlanabilir tutulmalı.

## 1. Ürünün temel mimarisi

```
Ham kullanıcı talebi
        ↓
Proje bağlamı seçimi
        ↓
Gizli bilgi temizleme
        ↓
DeepSeek Prompt Compiler
        ↓
Ortak TaskSpec JSON
        ↓
Kural ve kalite kontrolü
        ↓
Provider Renderer
   ├── Qwen Code çıktısı
   ├── Codex çıktısı
   └── Claude Code çıktısı
        ↓
Kopyala / dosyaya yaz / CLI'da aç
        ↓
Sonucu ve tüketimi kaydet
```

Buradaki en önemli karar:
DeepSeek doğrudan üç ayrı prompt üretmeyecek. Önce tek bir tarafsız ve yapılandırılmış TaskSpec oluşturacak. Sonrasında deterministic renderer, bu görevi Qwen, Codex ve Claude formatına dönüştürecek.

Bunun faydası:

- Modeller arasında görevin anlamı değişmez
- DeepSeek'in üç farklı yorum üretmesi engellenir
- Daha az API tokenı tüketilir
- Provider şablonları ayrı ayrı geliştirilebilir
- Aynı görevin üç modeldeki başarısı karşılaştırılabilir

## 2. Lokal uygulama teknolojisi

### Önerilen yapı

| Katman | Tercih |
| --- | --- |
| Masaüstü uygulaması | Tauri 2 |
| Arayüz | React, Vite, TypeScript |
| Arayüz bileşenleri | Tailwind CSS, shadcn/ui |
| Lokal veri tabanı | SQLite |
| Veri erişimi | Drizzle ORM veya Tauri SQL plugin |
| Lokal dosya erişimi | Tauri filesystem |
| API çağrıları | Rust backend üzerinden reqwest |
| API anahtarı | macOS Keychain |
| Şema doğrulama | Zod ve JSON Schema |
| Lokal metin arama | SQLite FTS5 |
| Token tahmini | Model bazlı tokenizer veya yaklaşık sayaç |
| Paketleme | macOS .dmg |

### Neden Next.js yerine Tauri?

Next.js ile hızlı prototip yapılabilir, fakat bu ürünün:

- Lokal proje klasörlerini okuması
- Markdown dosyalarını yazması
- Qwen, Codex ve Claude CLI'larını açması
- API anahtarını güvenli saklaması
- Sistem panosuna erişmesi

gerekecek. Tauri bu kullanım için daha doğru temel.

Rust tarafı minimum tutulacak. Ürün mantığının büyük kısmı TypeScript olacak.

## 3. Proje izolasyonu

Her ürün kendi bağlamına sahip olacak. Projeler arasında hiçbir bilgi otomatik taşınmayacak.

Örnek:

```
PromptForge Projects
├── AI Feedback SaaS
├── Marketplace Generator
├── Local Fitness App
└── WASK Internal Tool
```

Her proje için şu bilgiler saklanacak:

| Alan | İçerik |
| --- | --- |
| Product | Ürün amacı ve değer önerisi |
| Users | Hedef kullanıcılar |
| Current State | Şu anda çalışan ve eksik alanlar |
| Tech Stack | Frontend, backend, veri tabanı, servisler |
| Architecture | Teknik yapı ve kararlar |
| Design System | Görsel dil ve bileşen kuralları |
| Data Model | Tablolar, ilişkiler ve yetkiler |
| Integrations | Stripe, Supabase, e-posta, API'lar |
| Decisions | Daha önce alınmış kararlar |
| Constraints | Dokunulmaması gereken alanlar |
| Testing | Çalıştırılacak test ve kontrol komutları |
| Deployment | Hosting, ortamlar ve yayın süreci |
| Backlog | Planlanan görevler |
| Current Milestone | Üzerinde çalışılan aşama |

## 4. Proje klasör yapısı

Her ürünün kod deposunda gizli bir `.promptforge` klasörü bulunmalı:

```
product-root/
├── .promptforge/
│   ├── project.yaml
│   ├── context/
│   │   ├── PRODUCT.md
│   │   ├── ARCHITECTURE.md
│   │   ├── DESIGN.md
│   │   ├── DATA_MODEL.md
│   │   ├── INTEGRATIONS.md
│   │   ├── SECURITY.md
│   │   ├── TESTING.md
│   │   ├── DECISIONS.md
│   │   ├── CURRENT_STATE.md
│   │   └── BACKLOG.md
│   ├── tasks/
│   ├── templates/
│   └── promptforge.json
├── AGENTS.md
├── QWEN.md
├── CLAUDE.md
└── source-code/
```

### Dosya rolleri

**AGENTS.md** — Ortak ve provider-bağımsız geliştirme kuralları burada tutulacak:

- Mimari kurallar
- Kodlama standartları
- Test komutları
- Güvenlik kuralları
- İlgisiz dosyaları değiştirmeme
- Geri döndürülemez işlemlerde onay alma
- Paket yöneticisi
- Temel klasör yapı

Codex, repository içindeki AGENTS.md dosyalarını görev başlamadan önce rehber olarak kullanabiliyor.
Qwen Code da mevcut AGENTS.md dosyasını okuyabildiği için aynı kuralları ikinci kez QWEN.md içine kopyalamaya gerek yok.

**QWEN.md** — Yalnızca Qwen'e özel davranışlar:

```markdown
# Qwen-specific instructions

- Follow AGENTS.md as the shared repository instruction source.
- Inspect relevant existing files before making changes.
- Do not scan the full repository unless the task requires it.
- Prefer targeted tests over the complete suite during iteration.
- Do not create subagents unless the task is explicitly marked Deep.
- Stop before destructive database or deployment operations.
- At completion, report changed files, tests, assumptions and remaining risks.

# Project context

- Product: @.promptforge/context/PRODUCT.md
- Current state: @.promptforge/context/CURRENT_STATE.md
```

Qwen Code her yeni oturumda QWEN.md dosyasını yükleyebiliyor ve `@path` biçimindeki dosya referanslarını destekliyor. Qwen ayrıca bu dosyanın kısa ve spesifik tutulmasını öneriyor.

**CLAUDE.md**

```markdown
@AGENTS.md

# Claude-specific instructions

- Use planning mode before high-risk architectural, billing or database work.
- Do not over-engineer beyond the task scope.
- Explicitly inspect edge cases and failure states.
- Explain material architectural trade-offs before applying them.
```

Claude Code, CLAUDE.md üzerinden kalıcı proje talimatlarını yükleyebiliyor. Anthropic ayrıca mevcut AGENTS.md dosyasının `@AGENTS.md` biçiminde Claude dosyasına aktarılmasını doğrudan destekliyor.

## 5. Ana veri modeli: TaskSpec

DeepSeek'in üretmesi gereken esas çıktı şu olacak:

```json
{
  "task_id": "TASK-2026-0042",
  "project_id": "project-ai-feedback",
  "task_type": "feature",
  "execution_mode": "standard",
  "target_provider": "qwen",
  "objective": "Authenticated users can view their AI credit usage.",
  "user_value": "Users understand remaining usage before reaching the limit.",
  "current_state": [
    "Authentication already exists",
    "Stripe subscription records are stored in Supabase"
  ],
  "relevant_context": [
    "DESIGN.md",
    "DATA_MODEL.md",
    "INTEGRATIONS.md"
  ],
  "assumptions": [],
  "blocking_questions": [],
  "scope": [
    "Create the usage page",
    "Show plan, consumed credits and renewal date",
    "Add loading, empty and error states"
  ],
  "out_of_scope": [
    "Creating new Stripe prices",
    "Admin reporting",
    "Email notifications"
  ],
  "requirements": {
    "functional": [],
    "frontend": [],
    "backend": [],
    "data": [],
    "security": [],
    "accessibility": [],
    "performance": []
  },
  "edge_cases": [],
  "acceptance_criteria": [],
  "execution_plan": [],
  "test_plan": [],
  "stop_conditions": [],
  "final_report": [],
  "risk_level": "medium",
  "confidence": 0.87,
  "estimated_prompt_tokens": 1450
}
```

Bu JSON, sistemin esas sözleşmesi olacak. Final prompt sadece bu sözleşmenin seçilen modele göre görünür hale getirilmiş biçimi olacak.

## 6. DeepSeek'in çalışma biçimi

### Sistem talimatı

DeepSeek'e verilen kalıcı sistem promptu şu davranışları zorlamalı:

```
You are a software-development task compiler.

Your job is not to implement code.
Your job is to transform an informal user request into a precise,
minimal and executable TaskSpec JSON for a coding agent.

Rules:
1. Preserve the user's actual intent.
2. Never invent project facts.
3. Separate known facts from assumptions.
4. Ask questions only when missing information blocks correct execution.
5. Resolve minor and reversible decisions using existing project conventions.
6. Do not expand the task beyond the requested outcome.
7. Include relevant failure states and acceptance criteria.
8. Include only context that materially affects the task.
9. Never include secrets, API keys or personal data.
10. Require confirmation before destructive or irreversible actions.
11. Return valid JSON matching the supplied schema.
12. Avoid explanatory prose outside the JSON.
```

### Model çağrı stratejisi

| Mod | DeepSeek çağrısı | Kullanım |
| --- | --- | --- |
| Quick | 0 veya 1 | Küçük metin, renk, yerleşim değişikliği |
| Standard | 1 | Normal özellik veya hata düzeltme |
| Deep | 2 | Mimari, ödeme, güvenlik, büyük backend işi |
| Review | 1 | Kod veya uygulama denetimi |
| Plan | 1 | Ürün ve teknik planlama |

### Deep modunda iki aşama

1. **Compiler:** TaskSpec üretir.
2. **Critic:** TaskSpec içinde eksik, çelişkili veya gereksiz maddeleri kontrol eder.

İkinci model sıfırdan prompt üretmez. Yalnızca mevcut JSON üzerinde düzeltme önerir.

DeepSeek API, JSON çıktı modunu destekliyor. Ancak resmî doküman JSON modunun zaman zaman boş içerik döndürebileceğini belirtiyor. Bu nedenle uygulamada şema doğrulaması ve kontrollü retry bulunmalı.

### Retry akışı

```
İlk JSON çağrısı
    ↓
Zod validation
    ├── Geçerli → devam
    └── Geçersiz veya boş
            ↓
       Tek repair çağrısı
            ↓
       Tekrar validation
            ├── Geçerli → devam
            └── Geçersiz → kullanıcıya hata göster
```

Sistem sessizce hatalı prompt üretmemeli.

## 7. Provider bazlı çıktı üretimi

Ortak TaskSpec aynı kalacak. Yalnızca sunuş ve çalışma talimatları değişecek.

| Özellik | Qwen Code | Codex | Claude Code |
| --- | --- | --- | --- |
| Varsayılan kullanım | Ana geliştirme | Kota alternatifi ve ikinci kontrol | Zor mimari ve kod inceleme |
| Kalıcı dosya | QWEN.md + AGENTS.md | AGENTS.md | CLAUDE.md + AGENTS.md |
| Prompt yapısı | Daha açık görev adımları | Sonuç ve sınır odaklı | Plan, risk ve edge-case odaklı |
| Dosya bağlamı | @path referansı | Görev içinde yollar | @path veya CLAUDE.md |
| Test talimatı | Hedefli testler | Uygula ve doğrula | Önce plan, sonra doğrula |
| Varsayılan derinlik | Standard | Standard | Deep veya Review |

### Qwen çıktısı

```markdown
## Task

Create an authenticated usage page that shows the user's current plan,
consumed credits, remaining credits and renewal date.

## Read first

- Follow AGENTS.md and QWEN.md.
- Read:
  - .promptforge/context/DESIGN.md
  - .promptforge/context/DATA_MODEL.md
  - .promptforge/context/INTEGRATIONS.md

## Current state

...

## Scope

...

## Out of scope

...

## Requirements

...

## Acceptance criteria

...

## Execution rules

1. Inspect the relevant existing implementation before editing.
2. Reuse the existing design system and billing flow.
3. Do not create duplicate data structures.
4. Do not modify unrelated files.
5. Run targeted lint, typecheck and tests.
6. Stop before destructive migrations or production deployment.
7. Report changed files, validations and unresolved risks.
```

### Codex çıktısı

Codex promptu daha sonuç odaklı olacak:

```markdown
Implement the authenticated usage page described below.

Use AGENTS.md as the repository instruction source. Inspect the existing
billing, authentication and dashboard implementations before making changes.

Required outcome:
...

Constraints:
...

Acceptance criteria:
...

Complete the implementation, run the relevant validations, and report:
- files changed
- commands executed
- test results
- assumptions
- remaining risks
```

### Claude çıktısı

Claude promptu daha fazla plan ve risk kontrolü içerecek:

```markdown
Review AGENTS.md and CLAUDE.md first.

Before editing, produce a concise implementation plan covering:
- existing components to reuse
- data flow
- authorization
- error states
- tests

Then implement the approved scope.

Do not introduce new abstractions unless the existing architecture requires
them. Stop and explain before any material schema, billing or deployment change.

...
```

## 8. Kullanım modları

Ana ekranda iki farklı seçim olacak.

### Görev tipi

- Planlama
- Yeni özellik
- Arayüz
- Backend
- Veritabanı
- Entegrasyon
- Hata düzeltme
- Yeniden yapılandırma
- Kod inceleme
- Güvenlik
- Test
- Yayına alma

### Derinlik

| Seviye | Davranış |
| --- | --- |
| Auto | Sistem göreve göre seçer |
| Quick | Kısa prompt, minimum bağlam |
| Standard | Normal kapsam ve kabul kriterleri |
| Deep | Risk, mimari, edge-case ve detaylı test planı |

### Varsayılan ayarlar

```
Provider: Qwen
Task Type: Auto
Depth: Auto
```

## 9. Ana kullanıcı deneyimi

### Ekran 1: Projects

Sol tarafta:

- Projeler
- Aktif aşama
- Son görev
- Son kullanılan model
- Prompt başarı oranı
- Güncel risk veya eksik bağlam uyarıları

Yeni proje oluştururken:

1. Proje klasörünü seç
2. README ve yapılandırma dosyalarını tara
3. Kullanılacak belgeleri seç
4. DeepSeek ile taslak proje profili oluştur
5. Kullanıcıya onaylat
6. AGENTS.md, QWEN.md ve CLAUDE.md önerilerini göster
7. Onay sonrası dosyalara yaz

Hiçbir mevcut dosya kullanıcı onayı olmadan üzerine yazılmamalı.

### Ekran 2: Compiler

```
┌────────────────────────────────────────────────────────────┐
│ Project: Feedback SaaS    Target: Qwen    Mode: Auto       │
├──────────────────────┬─────────────────────────────────────┤
│ Raw request          │ Relevant context                    │
│                      │                                     │
│ "Usage ekranını..."  │ ✓ DESIGN.md                         │
│                      │ ✓ DATA_MODEL.md                     │
│                      │ ✓ INTEGRATIONS.md                   │
│                      │                                     │
│ Attach files/images  │ Context budget: 1,240 / 2,000       │
├──────────────────────┴─────────────────────────────────────┤
│                    Compile Prompt                          │
└────────────────────────────────────────────────────────────┘
```

### Ekran 3: Result

Sekmeler:

- Qwen
- Codex
- Claude
- TaskSpec
- Raw vs Compiled
- Context sent

Sağ tarafta gerçek bir "87/100 kalite puanı" gösterilmemeli. Böyle puanlar çoğunlukla yapay güven yaratır.
Onun yerine doğrulanabilir kontrol listesi kullanılmalı:

```
✓ Objective is explicit
✓ Scope is bounded
✓ Acceptance criteria exist
✓ Relevant context is included
✓ Destructive actions require approval
⚠ Billing data source is assumed
```

Butonlar:

- Copy Prompt
- Save Task
- Open in Terminal
- Write Task File
- Edit
- Recompile
- Mark as Used

## 10. Kritik soru sistemi

PromptForge her görevde soru sormamalı.

### Sormaması gerekenler

- Butonun tam köşe yarıçapı
- Dosya adının küçük farklılıkları
- Geri döndürülebilir görsel kararlar
- Mevcut tasarım sisteminden anlaşılabilen konular

### Sorması gerekenler

- Ödeme sisteminin hangisi olduğu bilinmiyorsa
- Veri silme veya migration gerekiyorsa
- İki farklı mimari yaklaşım ürün davranışını değiştiriyorsa
- Yetkilendirme kuralı belirsizse
- Kullanıcı beklentisi iki farklı sonuca açıkça bölünüyorsa

Maksimum üç engelleyici soru sorulmalı.

Cevap beklemeyen varsayımlar final promptta açıkça gösterilmeli:

```
Assumption:
Use the existing dashboard card components because no new design system
was requested.
```

## 11. Bağlam seçimi ve token verimliliği

Token tasarrufunun ana kaynağı promptu kısaltmak değil, modele gereksiz proje içeriği göndermemek olacak.

### Context budget

| Mod | Proje bağlamı hedefi |
| --- | --- |
| Quick | 300–700 token |
| Standard | 800–2.000 token |
| Deep | 2.000–5.000 token |
| Review | İncelenecek alan kadar |

### Seçim mantığı

Örneğin bir tasarım görevi için:

- PRODUCT.md
- DESIGN.md
- CURRENT_STATE.md

Bir Stripe hatası için:

- INTEGRATIONS.md
- DATA_MODEL.md
- SECURITY.md
- CURRENT_STATE.md

Bütün belgeler hiçbir zaman otomatik eklenmemeli.

İlk sürümde vektör veri tabanı kullanmayalım. İlk sürüm için:

- Başlıklar
- Etiketler
- Görev tipi
- Dosya açıklamaları
- SQLite FTS5

yeterli olacaktır.

Embedding ve vektör araması ancak proje belgeleri gerçekten büyüdüğünde eklenmeli. İlk sürümde gereksiz karmaşıklık yaratır.

### Belge özetleri

Her belge için:

- Dosya hash'i
- Son güncelleme tarihi
- 200–500 tokenlık özet
- Etiketler
- İlgili görev türleri

saklanacak. Dosya değişmediyse tekrar özetlenmeyecek.

## 12. Görsel ve ekran görüntüsü kullanımı

DeepSeek Flash endpointiniz görsel desteklemiyorsa bile ürün görsel eklemeyi desteklemeli.

Akış:

1. Görsel lokal olarak saklanır.
2. Kullanıcı kısa bir not ekler.
3. DeepSeek'e görselin kendisi değil, dosya adı ve kullanıcının açıklaması gönderilir.

Final prompt içine şu eklenir:

```
Visual reference:
Inspect the attached file `dashboard-current.png` before implementing.
Preserve the existing navigation and component hierarchy.
```

Görseli doğrudan Qwen, Codex veya Claude tarafında eklersin. Böylece PromptForge'un modelinin görsel desteğine bağımlı kalmayız.

## 13. Güvenlik ve gizlilik

Ürün lokal olsa bile seçili içerikler DeepSeek API'ye gidecek. Bu nedenle API çağrısından önce mutlaka bir temizleme katmanı bulunmalı.

### Varsayılan olarak engellenecek dosyalar

```
.env
.env.*
*.pem
*.key
credentials.json
secrets.*
node_modules/
.git/
dist/
build/
.next/
coverage/
```

### Secret detection

API'ye gönderilmeden önce şu örüntüler aranmalı:

- API key
- Bearer token
- Private key
- AWS credential
- Database connection string
- JWT
- OAuth secret
- Stripe secret key
- Supabase service role key

Kullanıcı "Context Sent" ekranında DeepSeek'e gidecek gerçek içeriği görebilmeli.

### İzin sistemi

PromptForge şu işlemleri kullanıcı onayı olmadan yapmamalı:

- Mevcut bağlam dosyasını değiştirmek
- AGENTS.md, QWEN.md veya CLAUDE.md üzerine yazmak
- Terminal komutu çalıştırmak
- CLI açıp prompt göndermek
- Git commit oluşturmak
- Migration çalıştırmak
- Yayına almak

## 14. Geçmiş ve başarı ölçümü

Her kullanım kaydedilecek:

| Ölçüm | Açıklama |
| --- | --- |
| Raw prompt | Senin ilk yazdığın |
| Compiled prompt | Kullanılan final çıktı |
| Target provider | Qwen, Codex veya Claude |
| Compiler tokens | DeepSeek giriş ve çıkışı |
| Final prompt tokens | AI'ya verilen tahmini token |
| Completion result | Başarılı, kısmen başarılı, başarısız |
| Revision count | Kaç ek prompt gerekti |
| Scope violation | İlgisiz dosya değişti mi |
| Tests passed | Test durumu |
| Completion time | Görev süresi |
| User note | Sorun veya başarı açıklaması |

Qwen Code, `/stats` export ile kullanım verisini CSV veya JSON olarak dışa aktarabiliyor. İlerleyen sürümde bu dosya PromptForge'a alınarak görev ve kredi tüketimi ilişkilendirilebilir.

Codex ve Claude tarafında aynı detay görünmüyorsa manuel veya tahmini kullanım saklanır. Tahmin gerçek veri gibi gösterilmez.

## 15. Proje hafızası güncelleme sistemi

Her görev tamamlandıktan sonra PromptForge şu soruyu değerlendirecek:

> Bu görev sonucunda proje hakkında kalıcı olarak saklanması gereken yeni bir karar oluştu mu?

Örnek:

```
Stripe Customer Portal is now the only supported subscription-management flow.
```

Sistem bunu doğrudan yazmayacak. Şu şekilde öneri gösterecek:

```
Suggested context update

File: INTEGRATIONS.md
Section: Billing

Add:
"Subscription upgrades and cancellations must use the existing Stripe
Customer Portal flow. Do not create a custom billing-management interface."
```

Kullanıcı onaylarsa dosyaya yazılacak.
Böylece proje bağlamı güncel kalırken modelin yanlış kararları kalıcı hafızaya dönüşmez.

## 16. İlk sürüm kapsamı

### MVP'de olacaklar

- Lokal masaüstü uygulaması
- Birden fazla izole proje
- Proje klasörü seçme
- Markdown bağlam dosyaları
- DeepSeek API ayarları
- Quick, Standard, Deep ve Review modları
- TaskSpec JSON üretimi
- JSON doğrulama ve retry
- Qwen, Codex ve Claude renderer'ları
- Raw prompt ile final prompt karşılaştırması
- İlgili bağlam seçimi
- Secret redaction
- Prompt geçmişi
- Tek tıkla kopyalama
- AGENTS.md, QWEN.md ve CLAUDE.md üretim önerileri
- Görev başarı değerlendirmesi
- DeepSeek token kaydı
- Tüm verilerin lokal SQLite'ta tutulması

### MVP'de olmayacaklar

- Otomatik kod değiştirme
- Otomatik git commit
- Otomatik deployment
- Çok kullanıcılı sistem
- Cloud sync
- Abonelik
- GitHub entegrasyonu
- Vektör veri tabanı
- Modelin doğrudan terminal kontrolü
- Kullanıcı onayı olmadan bağlam güncelleme
- Üç modeli aynı anda çalıştırma

Bunlar ürünün ilk amacından uzaklaştırır.

## 17. Geliştirme sırası

**Aşama 1: Temel uygulama**

- Tauri kurulumu
- SQLite
- Proje ekleme
- Ayarlar
- DeepSeek bağlantı testi
- Ham prompt ekranı

**Aşama 2: Compiler**

- TaskSpec şeması
- DeepSeek sistem promptu
- JSON mode
- Zod validation
- Retry
- Blocking-question sistemi

**Aşama 3: Proje bağlamı**

- Context dosyaları
- Dosya hash'i
- FTS5 arama
- Context budget
- Secret detection
- "Context sent" önizlemesi

**Aşama 4: Provider renderer'ları**

- Qwen renderer
- Codex renderer
- Claude renderer
- Provider karşılaştırma ekranı
- Kalıcı talimat dosyaları

**Aşama 5: Ölçüm**

- Prompt geçmişi
- Sonuç değerlendirmesi
- Revision count
- DeepSeek usage
- Qwen stats import
- Proje ve provider bazlı rapor

**Aşama 6: CLI bağlantıları**

- Copy to clipboard
- Terminalde proje klasörünü aç
- Qwen Code başlat
- Codex başlat
- Claude Code başlat
- Prompt gönderilmeden önce son kullanıcı onayı

## 18. Başarı kriterleri

İlk 50 gerçek görevde şu sonuçları aramalıyız:

| Metrik | Hedef |
| --- | --- |
| İlk denemede doğru tamamlama | En az %15 artış |
| Ek düzeltme promptu | En az %25 azalma |
| Toplam Qwen kredisi | En az %15 azalma |
| İlgisiz dosya değişikliği | En az %50 azalma |
| Kullanıcı tarafından yeniden prompt yazma | En az %30 azalma |
| Projeler arası bağlam karışması | Sıfır |
| Gizli bilgi gönderimi | Sıfır |

Bu hedeflerden yalnızca prompt uzunluğu düşüyor fakat toplam kredi veya revizyon sayısı azalmıyorsa ürün gerçek fayda sağlamıyor demektir.

## Final ürün tanımı

PromptForge Local, kullanıcının doğal ve eksik olabilecek taleplerini, seçili ürünün teknik ve ürün bağlamını kullanarak doğrulanabilir geliştirme görevlerine dönüştüren lokal bir AI task compiler'dır. DeepSeek Flash, ortak TaskSpec üretir. Sistem bu TaskSpec'i ana olarak Qwen Code, ayrıca Codex ve Claude Code için ayrı çalışma promptlarına çevirir. Proje bilgileri lokal tutulur, yalnızca gerekli ve temizlenmiş bağlam DeepSeek'e gönderilir.

### Kesin teknoloji ve model kararı

```
Desktop: Tauri 2
Frontend: React + TypeScript + Vite
UI: Tailwind + shadcn/ui
Database: SQLite
Compiler AI: Configurable DeepSeek Flash API
Primary development target: Qwen Code
Secondary targets: Codex and Claude Code
Shared instruction source: AGENTS.md
Provider files: QWEN.md and CLAUDE.md
Canonical task format: TaskSpec JSON
Default mode: Qwen + Auto
```
