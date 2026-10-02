# Änderungen / Changelog

## 1.0.0 – 2026-10-02

Erste öffentliche Version. / First public release.

- Schichtplan mit Bereichen, Suche, Tagesauswahl und automatisch ausgeblendeten vergangenen Schichten
- Anmeldung ohne Konto, „Meine Schichten" zum Nachsehen und Abmelden
- Orga-Schichten unter `/orga` mit vollem Namen und Telefonnummer, optional mit Passwort geschützt
- Schicht-Generator für gleich lange Schichten, auch über Mitternacht
- Accounts mit Rechten und Bereichs-Freigaben, Hauptadmin, Passwort ändern
- Komplett zweisprachig (Deutsch/Englisch), Bereiche und Schichten optional mit englischem Text
- Branding im Admin-Bereich (Name, Logo, Motto, Fußzeile, Farbe)
- Datenschutz: Impressum-/Datenschutz-Links, automatisches Löschen der Anmeldungen 14 Tage nach der letzten Schicht
- Tägliches Backup, CSV-Export, QR-Code, Zurücksetzen für die nächste Con
- Docker-Image `ghcr.io/nkleins/helfertool` (amd64, arm64) und Variante mit automatischem HTTPS (Caddy)
