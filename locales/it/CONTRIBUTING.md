<div align="center">
<sub>

[English](../../CONTRIBUTING.md) 鈥?[Catal脿](../ca/CONTRIBUTING.md) 鈥?[Deutsch](../de/CONTRIBUTING.md) 鈥?[Espa帽ol](../es/CONTRIBUTING.md) 鈥?[Fran莽ais](../fr/CONTRIBUTING.md) 鈥?[啶灌た啶傕う啷€](../hi/CONTRIBUTING.md) 鈥?[Bahasa Indonesia](../id/CONTRIBUTING.md) 鈥?<b>Italiano</b> 鈥?[鏃ユ湰瑾瀅(../ja/CONTRIBUTING.md)

</sub>
<sub>

[頃滉淡鞏碷(../ko/CONTRIBUTING.md) 鈥?[Nederlands](../nl/CONTRIBUTING.md) 鈥?[Polski](../pl/CONTRIBUTING.md) 鈥?[Portugu锚s (BR)](../pt-BR/CONTRIBUTING.md) 鈥?[袪褍褋褋泻懈泄](../ru/CONTRIBUTING.md) 鈥?[T眉rk莽e](../tr/CONTRIBUTING.md) 鈥?[Ti岷縩g Vi峄噒](../vi/CONTRIBUTING.md) 鈥?[绠€浣撲腑鏂嘳(../zh-CN/CONTRIBUTING.md) 鈥?[绻侀珨涓枃](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuire a Roo Code

Roo Code 猫 un progetto guidato dalla comunit脿 e apprezziamo profondamente ogni contributo. Per semplificare la collaborazione, operiamo su una base [Issue-First](#approccio-issue-first), il che significa che tutte le [Pull Request (PR)](#invio-di-una-pull-request) devono prima essere collegate a un'issue di GitHub. Si prega di leggere attentamente questa guida.

## Sommario

- [Prima di contribuire](#prima-di-contribuire)
- [Trovare e pianificare il tuo contributo](#trovare-e-pianificare-il-tuo-contributo)
- [Processo di sviluppo e invio](#processo-di-sviluppo-e-invio)
- [Legale](#legale)

## Prima di contribuire

### 1. Codice di condotta

Tutti i contributori devono attenersi al nostro [Codice di condotta](./CODE_OF_CONDUCT.md).

### 2. Roadmap del progetto

La nostra roadmap guida la direzione del progetto. Allinea i tuoi contributi a questi obiettivi chiave:

### Affidabilit脿 prima di tutto

- Assicurati che la modifica dei diff e l'esecuzione dei comandi siano costantemente affidabili.
- Riduci i punti di frizione che scoraggiano l'uso regolare.
- Garantisci un funzionamento fluido in tutte le localizzazioni e piattaforme.
- Espandi un supporto solido per un'ampia variet脿 di provider e modelli di intelligenza artificiale.

### Esperienza utente migliorata

- Semplifica l'interfaccia utente/esperienza utente per chiarezza e intuitivit脿.
- Migliora continuamente il flusso di lavoro per soddisfare le elevate aspettative che gli sviluppatori hanno per gli strumenti di uso quotidiano.

### Leader nelle prestazioni degli agenti

- Stabilisci benchmark di valutazione completi (eval) per misurare la produttivit脿 nel mondo reale.
- Semplifica per tutti l'esecuzione e l'interpretazione di queste valutazioni.
- Fornisci miglioramenti che dimostrino chiari aumenti nei punteggi di valutazione.

Menziona l'allineamento con queste aree nelle tue PR.

### 3. Unisciti alla community di Roo Code

- **Principale:** Unisciti al nostro [Discord](https://github.com/tocodex-ai/tocodex-community/issues) e invia un DM a **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** I contributori esperti possono interagire direttamente tramite i [progetti GitHub](https://github.com/tocodex-ai/tocodex-community/issues).

## Trovare e pianificare il tuo contributo

### Tipi di contributi

- **Correzioni di bug:** risoluzione di problemi di codice.
- **Nuove funzionalit脿:** aggiunta di funzionalit脿.
- **Documentazione:** miglioramento di guide e chiarezza.

### Approccio Issue-First

Tutti i contributi iniziano con un'issue di GitHub utilizzando i nostri modelli snelli.

- **Controlla le issue esistenti**: cerca nelle [issue di GitHub](https://github.com/tocodex-ai/tocodex-community/issues).
- **Crea un'issue** utilizzando:
    - **Miglioramenti:** modello "Richiesta di miglioramento" (linguaggio semplice incentrato sul vantaggio per l'utente).
    - **Bug:** modello "Segnalazione di bug" (riproduzione minima + previsto vs effettivo + versione).
- **Vuoi lavorarci?** Commenta "Rivendico" sull'issue e invia un DM a **Hannes Rudolph (`hrudolph`)** su [Discord](https://github.com/tocodex-ai/tocodex-community/issues) per essere assegnato. L'assegnazione verr脿 confermata nel thread.
- **Le PR devono essere collegate all'issue.** Le PR non collegate possono essere chiuse.

### Decidere su cosa lavorare

- Controlla il [progetto GitHub](https://github.com/tocodex-ai/tocodex-community/issues) per le issue "Issue [Non assegnata]".
- Per la documentazione, visita [Roo Code Docs](https://github.com/tocodex-ai/tocodex-community).

### Segnalazione di bug

- Controlla prima le segnalazioni esistenti.
- Crea un nuovo bug utilizzando il [modello "Segnalazione di bug"](https://github.com/tocodex-ai/tocodex-community/issues/new/choose) con:
    - Passaggi di riproduzione chiari e numerati
    - Risultato previsto vs effettivo
    - Versione di Roo Code (obbligatoria); provider/modello di intelligenza artificiale se pertinente
- **Problemi di sicurezza**: segnala in privato tramite [avvisi di sicurezza](https://github.com/tocodex-ai/tocodex-community/security/advisories/new).

## Processo di sviluppo e invio

### Configurazione dello sviluppo

1. **Esegui il fork e clona:**

```
git clone https://github.com/TUO_NOME_UTENTE/Roo-Code.git
```

2. **Installa le dipendenze:**

```
pnpm install
```

3. **Debug:** apri con VS Code (`F5`).

### Linee guida per la scrittura del codice

- Una PR mirata per funzionalit脿 o correzione.
- Segui le migliori pratiche di ESLint e TypeScript.
- Scrivi commit chiari e descrittivi che facciano riferimento alle issue (ad es. `Risolve #123`).
- Fornisci test approfonditi (`npm test`).
- Esegui il rebase sul ramo `main` pi霉 recente prima dell'invio.

### Invio di una Pull Request

- Inizia come **bozza di PR** se cerchi un feedback iniziale.
- Descrivi chiaramente le tue modifiche seguendo il modello di Pull Request.
- Collega l'issue nella descrizione/titolo della PR (ad es. "Risolve #123").
- Fornisci screenshot/video per le modifiche all'interfaccia utente.
- Indica se sono necessari aggiornamenti alla documentazione.

### Politica sulle Pull Request

- Deve fare riferimento a un'issue di GitHub assegnata. Per essere assegnato: commenta "Rivendico" sull'issue e invia un DM a **Hannes Rudolph (`hrudolph`)** su [Discord](https://github.com/tocodex-ai/tocodex-community/issues). L'assegnazione verr脿 confermata nel thread.
- Le PR non collegate possono essere chiuse.
- Le PR devono superare i test di integrazione continua, essere in linea con la roadmap e avere una documentazione chiara.

### Processo di revisione

- **Triage giornaliero:** controlli rapidi da parte dei manutentori.
- **Revisione approfondita settimanale:** valutazione completa.
- **Itera prontamente** in base al feedback.

## Legale

Contribuendo, accetti che i tuoi contributi siano concessi in licenza con la licenza Apache 2.0, in coerenza con la licenza di Roo Code.
