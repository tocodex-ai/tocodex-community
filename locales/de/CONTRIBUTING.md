<div align="center">
<sub>

[English](../../CONTRIBUTING.md) 鈥?[Catal脿](../ca/CONTRIBUTING.md) 鈥?<b>Deutsch</b> 鈥?[Espa帽ol](../es/CONTRIBUTING.md) 鈥?[Fran莽ais](../fr/CONTRIBUTING.md) 鈥?[啶灌た啶傕う啷€](../hi/CONTRIBUTING.md) 鈥?[Bahasa Indonesia](../id/CONTRIBUTING.md) 鈥?[Italiano](../it/CONTRIBUTING.md) 鈥?[鏃ユ湰瑾瀅(../ja/CONTRIBUTING.md)

</sub>
<sub>

[頃滉淡鞏碷(../ko/CONTRIBUTING.md) 鈥?[Nederlands](../nl/CONTRIBUTING.md) 鈥?[Polski](../pl/CONTRIBUTING.md) 鈥?[Portugu锚s (BR)](../pt-BR/CONTRIBUTING.md) 鈥?[袪褍褋褋泻懈泄](../ru/CONTRIBUTING.md) 鈥?[T眉rk莽e](../tr/CONTRIBUTING.md) 鈥?[Ti岷縩g Vi峄噒](../vi/CONTRIBUTING.md) 鈥?[绠€浣撲腑鏂嘳(../zh-CN/CONTRIBUTING.md) 鈥?[绻侀珨涓枃](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Beitrag zu Roo Code

Roo Code ist ein von der Community getragenes Projekt, und wir sch盲tzen jeden Beitrag sehr. Um die Zusammenarbeit zu optimieren, arbeiten wir nach dem [Issue-First-Ansatz](#issue-first-ansatz), was bedeutet, dass alle [Pull Requests (PRs)](#einen-pull-request-einreichen) zuerst mit einem GitHub-Issue verkn眉pft sein m眉ssen. Bitte lies diesen Leitfaden sorgf盲ltig durch.

## Inhaltsverzeichnis

- [Bevor du beitr盲gst](#bevor-du-beitr盲gst)
- [Deinen Beitrag finden und planen](#deinen-beitrag-finden-und-planen)
- [Entwicklungs- und Einreichungsprozess](#entwicklungs-und-einreichungsprozess)
- [Rechtliches](#rechtliches)

## Bevor du beitr盲gst

### 1. Verhaltenskodex

Alle Mitwirkenden m眉ssen sich an unseren [Verhaltenskodex](./CODE_OF_CONDUCT.md) halten.

### 2. Projekt-Roadmap

Unsere Roadmap gibt die Richtung des Projekts vor. Richte deine Beitr盲ge an diesen Hauptzielen aus:

### Zuverl盲ssigkeit an erster Stelle

- Stelle sicher, dass die Diff-Bearbeitung und die Befehlsausf眉hrung durchweg zuverl盲ssig sind.
- Reduziere Reibungspunkte, die von der regelm盲脽igen Nutzung abhalten.
- Gew盲hrleiste einen reibungslosen Betrieb in allen Gebietsschemata und auf allen Plattformen.
- Erweitere die robuste Unterst眉tzung f眉r eine Vielzahl von KI-Anbietern und -Modellen.

### Verbesserte Benutzererfahrung

- Optimiere die UI/UX f眉r Klarheit und Intuitivit盲t.
- Verbessere kontinuierlich den Arbeitsablauf, um den hohen Erwartungen gerecht zu werden, die Entwickler an t盲glich genutzte Werkzeuge haben.

### F眉hrend in der Agentenleistung

- Etabliere umfassende Bewertungsma脽st盲be (evals), um die Produktivit盲t in der Praxis zu messen.
- Mache es f眉r jeden einfach, diese Bewertungen auszuf眉hren und zu interpretieren.
- Liefere Verbesserungen, die klare Steigerungen der Bewertungsergebnisse zeigen.

Erw盲hne die Ausrichtung auf diese Bereiche in deinen PRs.

### 3. Tritt der Roo Code Community bei

- **Prim盲r:** Tritt unserem [Discord](https://github.com/tocodex-ai/tocodex-community/issues) bei und schreibe eine DM an **Hannes Rudolph (`hrudolph`)**.
- **Alternative:** Erfahrene Mitwirkende k枚nnen sich direkt 眉ber [GitHub-Projekte](https://github.com/tocodex-ai/tocodex-community/issues) beteiligen.

## Deinen Beitrag finden und planen

### Arten von Beitr盲gen

- **Fehlerbehebungen:** Behebung von Code-Problemen.
- **Neue Funktionen:** Hinzuf眉gen von Funktionalit盲t.
- **Dokumentation:** Verbesserung von Anleitungen und Klarheit.

### Issue-First-Ansatz

Alle Beitr盲ge beginnen mit einem GitHub-Issue unter Verwendung unserer schlanken Vorlagen.

- **脺berpr眉fe bestehende Issues**: Suche in den [GitHub Issues](https://github.com/tocodex-ai/tocodex-community/issues).
- **Erstelle ein Issue** mit:
    - **Verbesserungen:** Vorlage 鈥濾erbesserungsvorschlag鈥?(einfache Sprache mit Fokus auf den Nutzen f眉r den Benutzer).
    - **Fehler:** Vorlage 鈥濬ehlerbericht鈥?(minimale Reproduktion + erwartet vs. tats盲chlich + Version).
- **M枚chtest du daran arbeiten?** Kommentiere 鈥濩laiming鈥?im Issue und schreibe eine DM an **Hannes Rudolph (`hrudolph`)** auf [Discord](https://github.com/tocodex-ai/tocodex-community/issues), um zugewiesen zu werden. Die Zuweisung wird im Thread best盲tigt.
- **PRs m眉ssen auf das Issue verweisen.** Nicht verkn眉pfte PRs k枚nnen geschlossen werden.

### Entscheiden, woran du arbeiten m枚chtest

- 脺berpr眉fe das [GitHub-Projekt](https://github.com/tocodex-ai/tocodex-community/issues) auf 鈥濱ssue [Unassigned]鈥?Issues.
- F眉r Dokumentation besuche [Roo Code Docs](https://github.com/tocodex-ai/tocodex-community).

### Fehler melden

- 脺berpr眉fe zuerst, ob bereits Berichte vorhanden sind.
- Erstelle einen neuen Fehler mit der [Vorlage 鈥濬ehlerbericht鈥淽(https://github.com/tocodex-ai/tocodex-community/issues/new/choose) mit:
    - Klaren, nummerierten Reproduktionsschritten
    - Erwartetes vs. tats盲chliches Ergebnis
    - Roo Code-Version (erforderlich); API-Anbieter/Modell, falls relevant
- **Sicherheitsprobleme**: Melde sie privat 眉ber [Sicherheitshinweise](https://github.com/tocodex-ai/tocodex-community/security/advisories/new).

## Entwicklungs- und Einreichungsprozess

### Entwicklungseinrichtung

1. **Fork & Klonen:**

```
git clone https://github.com/DEIN_BENUTZERNAME/Roo-Code.git
```

2. **Abh盲ngigkeiten installieren:**

```
pnpm install
```

3. **Debugging:** Mit VS Code 枚ffnen (`F5`).

### Richtlinien zum Schreiben von Code

- Ein fokussierter PR pro Funktion oder Fehlerbehebung.
- Befolge die Best Practices von ESLint und TypeScript.
- Schreibe klare, beschreibende Commits mit Verweis auf Issues (z. B. `Fixes #123`).
- Stelle gr眉ndliche Tests bereit (`npm test`).
- Rebase auf den neuesten `main`-Zweig vor der Einreichung.

### Einen Pull Request einreichen

- Beginne als **Entwurfs-PR**, wenn du fr眉hzeitig Feedback einholen m枚chtest.
- Beschreibe deine 脛nderungen klar und deutlich gem盲脽 der Pull-Request-Vorlage.
- Verkn眉pfe das Issue in der PR-Beschreibung/Titel (z. B. 鈥濬ixes #123鈥?.
- Stelle Screenshots/Videos f眉r UI-脛nderungen bereit.
- Gib an, ob Dokumentationsaktualisierungen erforderlich sind.

### Pull-Request-Richtlinie

- Muss auf ein zugewiesenes GitHub-Issue verweisen. Um zugewiesen zu werden: Kommentiere 鈥濩laiming鈥?im Issue und schreibe eine DM an **Hannes Rudolph (`hrudolph`)** auf [Discord](https://github.com/tocodex-ai/tocodex-community/issues). Die Zuweisung wird im Thread best盲tigt.
- Nicht verkn眉pfte PRs k枚nnen geschlossen werden.
- PRs m眉ssen die CI-Tests bestehen, mit der Roadmap 眉bereinstimmen und eine klare Dokumentation haben.

### 脺berpr眉fungsprozess

- **T盲gliche Triage:** Schnelle 脺berpr眉fungen durch die Betreuer.
- **W枚chentliche ausf眉hrliche 脺berpr眉fung:** Umfassende Bewertung.
- **Iteriere umgehend** basierend auf dem Feedback.

## Rechtliches

Indem du einen Beitrag leistest, stimmst du zu, dass deine Beitr盲ge unter der Apache-2.0-Lizenz lizenziert werden, die mit der Lizenzierung von Roo Code 眉bereinstimmt.
