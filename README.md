# Sprzedam Kłodzko

Lokalny serwis ogłoszeniowy dla Kłodzka oparty o Cloudflare Workers, D1 i Pages.

## Cel

Repo zawiera gotowy szkielet produkcyjny:

- publiczny frontend na Cloudflare Pages,
- backend API i zadania cykliczne na Cloudflare Workers,
- baza danych w Cloudflare D1,
- moderację przez OpenAI Moderation API,
- powiadomienia dla administratora przez ntfy.sh,
- panel administratora z loginem, hasłem, MFA i ograniczeniem IP.
- ochronę publicznych formularzy przez Turnstile i limity po IP.

## Struktura

- `frontend/public` - statyczny frontend Pages
- `src` - Worker API i job processor
- `schema.sql` - schemat D1
- `wrangler.toml` - konfiguracja Workera

## Wymagania

- konto Cloudflare z D1, Workers i Pages
- klucz OpenAI API
- adres ntfy.sh albo własny topic URL
- login i hasło administratora
- sekret TOTP do MFA
- allowlista IP dla panelu admina

## Zmienne środowiskowe

Sekrety ustaw przez `wrangler secret put`:

- `OPENAI_API_KEY`
- `NTFY_TOPIC_URL`
- `TURNSTILE_SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_TOTP_SECRET`
- `ADMIN_SESSION_SECRET`

Wartości konfiguracyjne w `wrangler.toml`:

- `SITE_NAME`
- `SITE_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `TURNSTILE_SITE_KEY` - publiczny klucz Turnstile
- `ADMIN_ALLOWED_IPS` - allowlista IP/CIDR dla panelu admina
- limity publikacji,
- liczba dni do przypomnienia o wygaśnięciu.

## Baza D1

1. Utwórz bazę:

```bash
wrangler d1 create sprzedam-klodzko-db
```

2. Wstaw `database_id` do `wrangler.toml`.

3. Załaduj schemat:

```bash
wrangler d1 execute sprzedam-klodzko-db --file=./schema.sql
```

4. Zrób eksport kopii zapasowej:

```bash
wrangler d1 export sprzedam-klodzko-db --remote --output ./backups/sprzedam-klodzko-db.sql
```

5. Przywróć kopię zapasową:

```bash
wrangler d1 execute sprzedam-klodzko-db --remote --file=./backups/sprzedam-klodzko-db.sql
```

Jeśli chcesz wykonać to lokalnie na bazie developerskiej, użyj tej samej komendy przeciwko lokalnemu środowisku D1.

## Worker API

Worker obsługuje:

- `GET /api/health`
- `GET /api/config`
- `GET /api/categories`
- `GET /api/listings`
- `POST /api/listings`
- `GET /api/listings/:id`
- `GET /api/listings/:id/verify?token=...`
- `POST /api/listings/:id/report`
- `GET|PUT|DELETE /api/manage/:token`
- `POST /api/manage/:token/extend`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET /api/admin/dashboard`
- `GET /api/admin/listings`
- `GET /api/admin/reports`
- `GET /api/admin/logs`
- `GET /api/admin/users`
- `POST /api/admin/listings/:id/action`
- `POST /api/admin/reports/:id/action`

## Logika publikacji

1. Użytkownik dodaje ogłoszenie.
2. System zapisuje je jako `pending`.
3. Frontend pokazuje link weryfikacyjny i link zarządzania.
4. Po kliknięciu linku weryfikacyjnego ogłoszenie trafia do kolejki moderacji.
5. OpenAI Moderation API decyduje, czy ogłoszenie przechodzi.
6. Po akceptacji ogłoszenie od razu staje się publiczne na 30 dni.
7. Cron sprawdza wygasanie i przypomnienia.

## Frontend Pages

Frontend jest w `frontend/public`.

### Publiczne strony

- `/` - strona główna z listą ogłoszeń i formularzem dodawania
- `/kategoria/:slug` - landing page kategorii z listą i filtrami
- `/ogloszenie/:slug` - szczegóły ogłoszenia przez redirect z `/_redirects`
- `/manage?token=...` - zarządzanie ogłoszeniem z linku zapisanego po dodaniu ogłoszenia
  - token `manage_listing` pozwala edytować i usuwać ogłoszenie
  - token `extend_listing` pozwala tylko odczytać ogłoszenie i przedłużyć publikację
- `/regulamin.html`
- `/polityka-prywatnosci.html`
- `/admin/` - panel administratora

### Wdrożenie Pages

1. Utwórz projekt Cloudflare Pages.
2. Jako katalog build ustaw `frontend/public`.
3. Nie używaj dodatkowego build step, to jest czysty statyczny frontend.
4. Frontend Pages jest podpięty do GitHub repo i deployuje się automatycznie z `main` oraz branchy preview.

## GitHub Actions

Repo jest przygotowane do deployu z GitHuba:

- `CI` uruchamia `npm run check` na pushach i pull requestach.
- `Deploy Worker` wdraża Workera na `main`.

Wymagane sekrety w GitHub:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Uwaga:

- Repo jest publiczne, więc ochronę `main` można utrzymać przez branch protection.

## Routing Worker + Pages

Najprostszy model to:

- Pages na `sprzedam.klodzko.pl`
- Worker na ścieżkach `sprzedam.klodzko.pl/api/*`

Jeżeli routing w Twoim koncie Cloudflare wymaga rozdzielenia hostów, ustaw API na osobnym subdomenie i wpisz go w `PUBLIC_API_BASE_URL`. Kod frontendowy korzysta z tego prefiksu.

Na domenach `*.pages.dev` plik `config.js` automatycznie kieruje frontend na dev Workera, więc dev flow nie wymaga ręcznego przepisania adresu API.

## Produkcja

Najprościej:

```bash
npm run setup:prod
```

Skrypt poprosi o:

- produkcyjne ID bazy D1,
- `TURNSTILE_SITE_KEY`,
- `ADMIN_ALLOWED_IPS`,
- dane administratora do regulaminu i polityki prywatności,
- sekrety do `wrangler secret put --env prod`.

1. Utwórz produkcyjną bazę D1 i wpisz `database_id` do sekcji `[env.prod]` w `wrangler.toml`.
2. Uzupełnij `TURNSTILE_SITE_KEY` w `wrangler.toml`.
3. Ustaw `ADMIN_ALLOWED_IPS` na konkretny adres IP albo CIDR z VPN.
4. Wgraj sekrety dla produkcji:

```bash
wrangler secret put --env prod OPENAI_API_KEY
wrangler secret put --env prod NTFY_TOPIC_URL
wrangler secret put --env prod ADMIN_USERNAME
wrangler secret put --env prod ADMIN_PASSWORD
wrangler secret put --env prod ADMIN_TOTP_SECRET
wrangler secret put --env prod ADMIN_SESSION_SECRET
wrangler secret put --env prod TURNSTILE_SECRET_KEY
```

5. Załaduj schemat na produkcyjną bazę:

```bash
wrangler d1 execute sprzedam-klodzko-db --env prod --remote --file=./schema.sql
```

6. Wdróż Workera:

```bash
wrangler deploy --env prod
```

7. W Cloudflare Pages ustaw katalog `frontend/public` i podepnij domenę `sprzedam.klodzko.pl`.
8. Dodaj route `sprzedam.klodzko.pl/api/*` do Workera `sprzedam-klodzko-api-prod`.
9. Do deployu Pages używaj:

```bash
wrangler pages deploy public --cwd frontend --project-name sprzedam-klodzko-dev --branch main --commit-dirty=true
```

10. Po deployu uruchom smoke test produkcji:

```bash
npm run smoke:prod
```

Skrypt sprawdza bez tworzenia danych:

- `/api/health`,
- `/api/categories`,
- `/api/listings`,
- `/`,
- `/admin/`,
- `/kategoria/elektronika`,
- `/sitemap.xml`,
- blokadę `POST /api/listings` bez tokenu Turnstile.

Jeżeli test `Public listing create is blocked without human verification` zacznie przechodzić jako publikacja zamiast błędu 400/429, traktuj to jako incydent bezpieczeństwa publicznego formularza.

## Local dev

1. Zainstaluj zależności:

```bash
npm install
```

2. Wygeneruj typy Workera:

```bash
npm run types
```

3. Sprawdź TypeScript:

```bash
npm run check
```

4. Uruchom Worker lokalnie:

```bash
npm run dev
```

5. Jeśli chcesz podejrzeć frontend lokalnie, uruchom prosty serwer statyczny w `frontend/public` albo użyj Pages preview.

## Runbook operacyjny

### Standardowy deploy po zmianach

```bash
npm run check
node --check frontend/public/app.js
node --check frontend/public/admin.js
node --check frontend/public/manage.js
npx wrangler@4.104.0 deploy --env prod --dry-run
npx wrangler@4.104.0 deploy --env prod
npx wrangler@4.104.0 pages deploy public --cwd frontend --project-name sprzedam-klodzko-dev --branch main --commit-dirty=true
npm run smoke:prod
```

### Ręczne smoke testy przed publicznym ogłoszeniem startu

- dodanie ogłoszenia z małym zdjęciem,
- zapisanie linku weryfikacyjnego i linku zarządzania,
- kliknięcie linku weryfikacyjnego,
- moderacja w `/admin/`,
- wejście w publiczny link ogłoszenia,
- edycja z linku zarządzania i powrót do moderacji,
- przedłużenie ogłoszenia,
- zgłoszenie naruszenia,
- obsługa zgłoszenia w panelu admina.

### Reakcja na problem z publikacją ogłoszeń

1. Sprawdź `npm run smoke:prod`.
2. Sprawdź `wrangler tail sprzedam-klodzko-api-prod --format json`.
3. Zweryfikuj, czy `TURNSTILE_SITE_KEY` i `TURNSTILE_SECRET_KEY` są ustawione dla prod.
4. Sprawdź limit payloadu i rozmiar zdjęcia. Produkcyjny limit zdjęcia to `MAX_IMAGE_BYTES`.
5. Jeżeli ogłoszenie zapisało się w D1, ale użytkownik dostał błąd, sprawdź logi `ntfy` i `event_logs`.

### Backup D1

Przed większymi zmianami lub kampanią promocyjną:

```bash
mkdir -p backups
npx wrangler@4.104.0 d1 export sprzedam-klodzko-db --env prod --remote --output ./backups/sprzedam-klodzko-db-$(date +%Y%m%d-%H%M).sql
```

## Sekrety i MFA

Do MFA używany jest TOTP. W praktyce:

- dodaj `ADMIN_TOTP_SECRET` do aplikacji Authenticator,
- podaj login, hasło i 6-cyfrowy kod przy logowaniu do `/admin/`.

`ADMIN_ALLOWED_IPS` przyjmuje listę IP albo prostych CIDR, rozdzielonych przecinkami. Przykład:

```text
203.0.113.10,198.51.100.0/24
```

## Ograniczenia i ryzyka

- Zdjęcia trzymane w D1 jako base64 szybko zwiększają rozmiar bazy. Praktycznie trzymaj pliki małe.
- Panel admina jest zabezpieczony IP plus MFA, ale panel publiczny i API muszą być wdrożone pod poprawnym routingiem, inaczej cookie sesji nie będzie działać wygodnie.
- Cron działa cyklicznie, więc przypomnienia i wygasanie są eventual consistency, nie natychmiast.
- Publiczne formularze mają limity po IP, a przy ustawionym Turnstile dostają dodatkową weryfikację anty-bot.
- To jest realny produkt, nie demo, ale przed wejściem na produkcję trzeba ręcznie sprawdzić przepływ linków, URL-e i routing Cloudflare.

## Smoke Testy

- `GET /api/health`
- `GET /api/config`
- `GET /api/categories`
- `GET /`
- dodanie ogłoszenia
- zapisanie linków weryfikacyjnych
- potwierdzenie linku
- publikacja ogłoszenia
- edycja ogłoszenia i ponowna moderacja
- przedłużenie ogłoszenia
- zgłoszenie ogłoszenia
- logowanie do `/admin/`
- sprawdzenie crona po godzinie

Jeżeli używasz Turnstile, sprawdź też czy widget pojawia się na formularzu publikacji i zgłoszenia.

## Komendy wdrożeniowe

```bash
# baza
wrangler d1 create sprzedam-klodzko-db
wrangler d1 execute sprzedam-klodzko-db --file=./schema.sql

# typy i kontrola
npm run types
npm run check

# deploy worker
npm run deploy

# deploy Pages
# użyj Cloudflare Pages albo wrangler pages deploy frontend/public
```
