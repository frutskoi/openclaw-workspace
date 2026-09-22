# КожЗам - Long-term Memory

## Принцип работы
- Босс только проверяет, я всё делаю сам
- **Сначала memory_search, потом LLM** — не тратить токены впустую

## Модели — какую и для чего
- **glm-5.2** — по умолчанию: чат, анализ, память, ответы
- **glm-5.1** — код, скрипты, дебаг, API, JSON (точнее в коде)
- **glm-5** — запасная, когда 5.2 перегружен (429)
- **glm-5-turbo** — subagent'ы на рутину (парсинг, сбор данных, проверки). Дёшево/быстро
- **glm-4.7-flash/flashx** — фолбэк, простые задачи/классификация
- **gpt-5.6-luna** — сложный reasoning: математика, наука, многоходовая логика. Дорого — беречь
- **gpt-5.6-terra** — баланс мощности/скорости, когда luna избыточен
- **gpt-5.6-sol** — длинный контекст (большой код, длинные документы)
- **gpt-5.5** — фолбэк последнего уровня
- **gpt-5.4 / mini** — параллельные subagent'ы, где важна надёжность а не глубина

### Правила переключения
- По умолчанию работаю на glm-5.2
- Код и скрипты → переключаюсь на glm-5.1 (`/model glm-5.1` или subagent)
- Сложный анализ → gpt-5.6-luna (только когда GLM не справляется, беречь токены)
- Subagent на рутину → spawn с `model: glm-5-turbo`
- OpenAI — только когда GLM не тянет или лежит. Токены ограничены

## Google сервисы
- Python + `google-api-python-client`
- Токены: `~/.openclaw/workspace/google-creds/token.json`
- Python venv: `~/.openclaw/venv/`
- Scopes: gmail, calendar, drive, sheets, docs, script
- Apps Script: ❌ `ui.toast()` не работает, ✅ `SpreadsheetApp.getUi().alert()`

## Apps Script
- **Первый запуск новой функции всегда делает Босс вручную** через меню таблицы
- Container-bound проект — `scripts().run()` через API возвращает 404
- Код заливаю через `projects().updateContent()`, потом Босс запускает

## Проверка перед отчётом
Никогда не пишу "готово" без проверки:
1. Код добавлен, запущен, работает
2. Данные загружены, логи записаны
3. Нет ошибок → только тогда пишу отчёт
## Consolidated Memory (2026-09-21)

<!-- openclaw-memory-promotion:memory:memory/2026-09-16.md:31:41 -->
- Next diagnostic step requested from user: 1. `tailscale ping -c 5 100.121.173.125` 2. inspect active Tailscale firewall rules; 3. inspect Windows network profiles. - Do not advise reinstalling Windows: base networking, DNS, direct server access, and Tailscale control connectivity are healthy. Continue targeted cleanup/debugging. - Keep Tailscale Exit Node set to None whenever sing-box is used. Bring sing-box back only after Tailscale is stable, using one service/process and one validated config. ## User preferences - Address user as “Босс”. - User prefers initiative, concise practical instructions, and careful verification before cl Source: memory/2026-09-16.md#L31-L41 <!-- trigger: network, cleanup/debugging, sing-box --> <!-- importance: 9 -->
<!-- openclaw-memory-promotion:memory:memory/2026-09-16.md:13:34 -->
- Gateway and Telegram were verified healthy after restart on 2026-09-16. ## Windows networking diagnosis - User’s Windows device is `frut`; server Tailscale IP is `100.121.173.125`, public server IP is `77.110.114.5`. - Root cause of repeated VPN/Tailscale failures was conflicting routing: Tailscale Exit Node was effectively enabled to the same server while sing-box was also active, creating a traffic loop. A stale `sing-box-daemon` service and multiple sing-box processes compounded the issue. - Windows diagnostics showed: - no system proxy and no WinHTTP proxy; - DNS via local router `192.168.1.1`; - both `sing-box-daemon` and Tails Source: memory/2026-09-16.md#L13-L34 <!-- trigger: gateway, network, router --> <!-- importance: 9 -->
<!-- openclaw-memory-promotion:memory:memory/2026-09-18.md:1:15 -->
- ## SSH/DPI (07:12 UTC) - Клиент Босса (frut, 77.222.107.70 = Dom.ru/ЭР-Телеком) не может SSH на 77.110.114.5:22 при выключенном Tailscale: kex_exchange_identification timeout. Тестовые TCP-пробники проходят, реальная SSH-сессия до сервера не доходит (лог sshd пуст) => DPI провайдера режет SSH на порту 22 к зарубежному IP. Тот же DPI объясняет Tailscale через DERP-релей (UDP заблокирован) у всех устройств Босса. - Решение: sshd через ssh.socket override (/etc/systemd/system/ssh.socket.d/ports.conf) дополнительно слушает порт 80 (22 оставлен). ufw 80/tcp уже открыт. Подключение: ssh -p 80 clawd@77.110.114.5 - Проверено: слушатели [::] Source: memory/2026-09-18.md#L1-L15 <!-- trigger: ssh/dpi, dom.ru/эр-телеком, kex-exchange-identification --> <!-- importance: 9 -->
<!-- openclaw-memory-promotion:memory:memory/2026-09-18.md:15:18 -->
- URL /dl/vless-xray-link.txt через Funnel больше не работает (Not Found): 18789 = сам gateway OpenClaw, пути /dl/ нет. - Перегенерировал ссылку из живого конфига: /home/clawd/vless-link.txt (pbk UA1Z..., sid dbf1404a, sni www.microsoft.com, flow xtls-rprx-vision). - Доставка клиенту: scp clawd@100.121.173.125:vless-link.txt Source: memory/2026-09-18.md#L15-L18 <!-- trigger: gateway, dl/vless-xray-link.txt, home/clawd/vless-link.txt --> <!-- importance: 8 -->
