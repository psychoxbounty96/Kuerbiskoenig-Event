# Kürbiskönig – Community Boss Event

> **Projektstatus: Pausiert**
>
> Die Weiterentwicklung und der produktive Eventbetrieb sind bis auf Weiteres pausiert. Der vorhandene technische Stand bleibt als getestete Grundlage erhalten; es findet derzeit kein offizieller Live-Eventbetrieb statt.

Kürbiskönig ist ein gemeinsames Twitch-Halloween-Event von PsychoXBounty. Der globale Boss, die öffentliche Eventseite und die StreamElements-Overlays teilen sich einen zentralen Supabase-State.

- [Öffentliche Eventseite](https://psychoxbounty96.github.io/Kuerbiskoenig-Event/)
- [Adminbereich](https://psychoxbounty96.github.io/Kuerbiskoenig-Event/admin/)
- [Kurzanleitung für teilnehmende Streamer](docs/STREAMER_SETUP.md)

Der Runtime-Stack besteht ausschließlich aus StreamElements, Supabase, Twitch API/EventSub sowie GitHub Pages. Es ist kein eigener Bot, kein OBS-Plugin und kein dauerhaft laufender Betreiber-PC erforderlich.

Aktueller Stand: Pre-Launch/Testbetrieb. Das Produktionsevent und produktiver passiver Schaden bleiben bis zur bewussten Freigabe deaktiviert. Statische Artworks dienen als funktionsfähige Platzhalter und können später über das versionierte Asset-Manifest durch Sprite-Sheets ersetzt werden.

Interne Betreiber-, Wiederherstellungs- und Abschlussdokumentation wird absichtlich nicht in diesem öffentlichen Repository geführt. Geheimnisse wie Service-Role-Key, Twitch Client Secret oder EventSub Secret gehören ausschließlich in die geschützten Supabase-/GitHub-Einstellungen.
