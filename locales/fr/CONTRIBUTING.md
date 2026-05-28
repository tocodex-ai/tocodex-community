<div align="center">
<sub>

[English](../../CONTRIBUTING.md) 鈥?[Catal脿](../ca/CONTRIBUTING.md) 鈥?[Deutsch](../de/CONTRIBUTING.md) 鈥?[Espa帽ol](../es/CONTRIBUTING.md) 鈥?<b>Fran莽ais</b> 鈥?[啶灌た啶傕う啷€](../hi/CONTRIBUTING.md) 鈥?[Bahasa Indonesia](../id/CONTRIBUTING.md) 鈥?[Italiano](../it/CONTRIBUTING.md) 鈥?[鏃ユ湰瑾瀅(../ja/CONTRIBUTING.md)

</sub>
<sub>

[頃滉淡鞏碷(../ko/CONTRIBUTING.md) 鈥?[Nederlands](../nl/CONTRIBUTING.md) 鈥?[Polski](../pl/CONTRIBUTING.md) 鈥?[Portugu锚s (BR)](../pt-BR/CONTRIBUTING.md) 鈥?[袪褍褋褋泻懈泄](../ru/CONTRIBUTING.md) 鈥?[T眉rk莽e](../tr/CONTRIBUTING.md) 鈥?[Ti岷縩g Vi峄噒](../vi/CONTRIBUTING.md) 鈥?[绠€浣撲腑鏂嘳(../zh-CN/CONTRIBUTING.md) 鈥?[绻侀珨涓枃](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuer 脿 Roo Code

Roo Code est un projet communautaire, et nous appr茅cions profond茅ment chaque contribution. Pour simplifier la collaboration, nous fonctionnons sur une base [d'abord l'issue](#approche-issue-first), ce qui signifie que toutes les [Pull Requests (PRs)](#soumettre-une-pull-request) doivent d'abord 锚tre li茅es 脿 une Issue GitHub. Veuillez lire attentivement ce guide.

## Table des mati猫res

- [Avant de contribuer](#avant-de-contribuer)
- [Trouver et planifier votre contribution](#trouver-et-planifier-votre-contribution)
- [Processus de d茅veloppement et de soumission](#processus-de-d茅veloppement-et-de-soumission)
- [L茅gal](#l茅gal)

## Avant de contribuer

### 1. Code de conduite

Tous les contributeurs doivent adh茅rer 脿 notre [Code de conduite](./CODE_OF_CONDUCT.md).

### 2. Feuille de route du projet

Notre feuille de route guide la direction du projet. Alignez vos contributions sur ces objectifs cl茅s :

### La fiabilit茅 d'abord

- Assurez-vous que l'茅dition de diff et l'ex茅cution de commandes sont fiables de mani猫re constante.
- R茅duisez les points de friction qui d茅couragent une utilisation r茅guli猫re.
- Garantissez un fonctionnement fluide dans toutes les langues et sur toutes les plateformes.
- 脡tendez le support robuste 脿 une grande vari茅t茅 de fournisseurs et de mod猫les d'IA.

### Exp茅rience utilisateur am茅lior茅e

- Simplifiez l'UI/UX pour plus de clart茅 et d'intuitivit茅.
- Am茅liorez continuellement le flux de travail pour r茅pondre aux attentes 茅lev茅es des d茅veloppeurs pour les outils 脿 usage quotidien.

### Leader en performance d'agent

- 脡tablissez des benchmarks d'茅valuation complets (evals) pour mesurer la productivit茅 en conditions r茅elles.
- Facilitez l'ex茅cution et l'interpr茅tation de ces 茅valuations par tout le monde.
- Livrez des am茅liorations qui d茅montrent des augmentations claires des scores d'茅valuation.

Mentionnez l'alignement avec ces domaines dans vos PRs.

### 3. Rejoignez la communaut茅 Roo Code

- **Principal :** Rejoignez notre [Discord](https://github.com/tocodex-ai/tocodex-community/issues) et envoyez un DM 脿 **Hannes Rudolph (`hrudolph`)**.
- **Alternative :** Les contributeurs exp茅riment茅s peuvent s'engager directement via les [Projets GitHub](https://github.com/tocodex-ai/tocodex-community/issues).

## Trouver et planifier votre contribution

### Types de contributions

- **Corrections de bugs :** R茅soudre les probl猫mes de code.
- **Nouvelles fonctionnalit茅s :** Ajouter des fonctionnalit茅s.
- **Documentation :** Am茅liorer les guides et la clart茅.

### Approche Issue-First

Toutes les contributions commencent par une Issue GitHub en utilisant nos mod猫les simples.

- **V茅rifiez les issues existantes** : Recherchez dans les [Issues GitHub](https://github.com/tocodex-ai/tocodex-community/issues).
- **Cr茅ez une issue** en utilisant :
    - **Am茅liorations :** Mod猫le "Demande d'am茅lioration" (langage simple ax茅 sur l'avantage pour l'utilisateur).
    - **Bugs :** Mod猫le "Rapport de bug" (reproduction minimale + attendu vs r茅el + version).
- **Vous voulez y travailler ?** Commentez "Claiming" sur l'issue et envoyez un DM 脿 **Hannes Rudolph (`hrudolph`)** sur [Discord](https://github.com/tocodex-ai/tocodex-community/issues) pour 锚tre assign茅. L'assignation sera confirm茅e dans le fil de discussion.
- **Les PRs doivent 锚tre li茅es 脿 l'issue.** Les PRs non li茅es peuvent 锚tre ferm茅es.

### D茅cider sur quoi travailler

- Consultez le [Projet GitHub](https://github.com/tocodex-ai/tocodex-community/issues) pour les issues "Issue [Non assign茅e]".
- Pour la documentation, visitez [Roo Code Docs](https://github.com/tocodex-ai/tocodex-community).

### Signaler des bugs

- V茅rifiez d'abord les rapports existants.
- Cr茅ez un nouveau bug en utilisant le [mod猫le "Rapport de bug"](https://github.com/tocodex-ai/tocodex-community/issues/new/choose) avec :
    - Des 茅tapes de reproduction claires et num茅rot茅es
    - R茅sultat attendu vs r茅el
    - Version de Roo Code (requise) ; fournisseur/mod猫le d'API si pertinent
- **Probl猫mes de s茅curit茅** : Signalez-les en priv茅 via les [avis de s茅curit茅](https://github.com/tocodex-ai/tocodex-community/security/advisories/new).

## Processus de d茅veloppement et de soumission

### Configuration du d茅veloppement

1. **Fork & Cloner :**

```
git clone https://github.com/VOTRE_NOM_UTILISATEUR/Roo-Code.git
```

2. **Installer les d茅pendances :**

```
pnpm install
```

3. **D茅bogage :** Ouvrir avec VS Code (`F5`).

### Lignes directrices pour l'茅criture de code

- Une PR cibl茅e par fonctionnalit茅 ou correction.
- Suivez les meilleures pratiques d'ESLint et de TypeScript.
- R茅digez des commits clairs et descriptifs faisant r茅f茅rence aux issues (par exemple, `Fixes #123`).
- Fournissez des tests approfondis (`npm test`).
- Rebasez sur la derni猫re branche `main` avant la soumission.

### Soumettre une Pull Request

- Commencez par une **PR en brouillon** si vous recherchez des commentaires pr茅coces.
- D茅crivez clairement vos changements en suivant le mod猫le de Pull Request.
- Liez l'issue dans la description/le titre de la PR (par exemple, "Fixes #123").
- Fournissez des captures d'茅cran/vid茅os pour les changements d'interface utilisateur.
- Indiquez si des mises 脿 jour de la documentation sont n茅cessaires.

### Politique de Pull Request

- Doit faire r茅f茅rence 脿 une Issue GitHub assign茅e. Pour 锚tre assign茅 : commentez "Claiming" sur l'issue et envoyez un DM 脿 **Hannes Rudolph (`hrudolph`)** sur [Discord](https://github.com/tocodex-ai/tocodex-community/issues). L'assignation sera confirm茅e dans le fil de discussion.
- Les PRs non li茅es peuvent 锚tre ferm茅es.
- Les PRs doivent passer les tests d'int茅gration continue, s'aligner sur la feuille de route et avoir une documentation claire.

### Processus de r茅vision

- **Triage quotidien :** V茅rifications rapides par les mainteneurs.
- **R茅vision hebdomadaire approfondie :** 脡valuation compl猫te.
- **It茅rez rapidement** en fonction des commentaires.

## L茅gal

En contribuant, vous acceptez que vos contributions soient sous licence Apache 2.0, conform茅ment 脿 la licence de Roo Code.
