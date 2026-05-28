<div align="center">
<sub>

[English](../../CONTRIBUTING.md) 鈥?[Catal脿](../ca/CONTRIBUTING.md) 鈥?[Deutsch](../de/CONTRIBUTING.md) 鈥?[Espa帽ol](../es/CONTRIBUTING.md) 鈥?[Fran莽ais](../fr/CONTRIBUTING.md) 鈥?[啶灌た啶傕う啷€](../hi/CONTRIBUTING.md) 鈥?[Bahasa Indonesia](../id/CONTRIBUTING.md) 鈥?[Italiano](../it/CONTRIBUTING.md) 鈥?[鏃ユ湰瑾瀅(../ja/CONTRIBUTING.md)

</sub>
<sub>

[頃滉淡鞏碷(../ko/CONTRIBUTING.md) 鈥?[Nederlands](../nl/CONTRIBUTING.md) 鈥?[Polski](../pl/CONTRIBUTING.md) 鈥?<b>Portugu锚s (BR)</b> 鈥?[袪褍褋褋泻懈泄](../ru/CONTRIBUTING.md) 鈥?[T眉rk莽e](../tr/CONTRIBUTING.md) 鈥?[Ti岷縩g Vi峄噒](../vi/CONTRIBUTING.md) 鈥?[绠€浣撲腑鏂嘳(../zh-CN/CONTRIBUTING.md) 鈥?[绻侀珨涓枃](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuindo para o Roo Code

O Roo Code 茅 um projeto impulsionado pela comunidade, e valorizamos profundamente cada contribui莽茫o. Para agilizar a colabora莽茫o, operamos com base em uma [abordagem de "primeiro a issue"](#abordagem-de-primeiro-a-issue), o que significa que todas as [Pull Requests (PRs)](#enviando-uma-pull-request) devem primeiro estar vinculadas a uma Issue do GitHub. Por favor, revise este guia com aten莽茫o.

## 脥ndice

- [Antes de contribuir](#antes-de-contribuir)
- [Encontrando e planejando sua contribui莽茫o](#encontrando-e-planejando-sua-contribui莽茫o)
- [Processo de desenvolvimento e envio](#processo-de-desenvolvimento-e-envio)
- [Legal](#legal)

## Antes de contribuir

### 1. C贸digo de Conduta

Todos os contribuidores devem aderir ao nosso [C贸digo de Conduta](./CODE_OF_CONDUCT.md).

### 2. Roteiro do projeto

Nosso roteiro guia a dire莽茫o do projeto. Alinhe suas contribui莽玫es com estes objetivos principais:

### Confiabilidade em primeiro lugar

- Garanta que a edi莽茫o de diff e a execu莽茫o de comandos sejam consistentemente confi谩veis.
- Reduza os pontos de atrito que desencorajam o uso regular.
- Garanta uma opera莽茫o tranquila em todas as localidades e plataformas.
- Expanda o suporte robusto para uma ampla variedade de provedores e modelos de IA.

### Experi锚ncia do usu谩rio aprimorada

- Simplifique a UI/UX para clareza e intuitividade.
- Melhore continuamente o fluxo de trabalho para atender 脿s altas expectativas que os desenvolvedores t锚m das ferramentas de uso di谩rio.

### Liderando no desempenho do agente

- Estabele莽a benchmarks de avalia莽茫o abrangentes (evals) para medir a produtividade do mundo real.
- Facilite para que todos possam executar e interpretar facilmente essas avalia莽玫es.
- Envie melhorias que demonstrem aumentos claros nas pontua莽玫es de avalia莽茫o.

Mencione o alinhamento com essas 谩reas em seus PRs.

### 3. Junte-se 脿 comunidade Roo Code

- **Principal:** Junte-se ao nosso [Discord](https://github.com/tocodex-ai/tocodex-community/issues) e envie uma DM para **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** Contribuidores experientes 屑芯谐褍褌 se envolver diretamente atrav茅s dos [Projetos do GitHub](https://github.com/tocodex-ai/tocodex-community/issues).

## Encontrando e planejando sua contribui莽茫o

### Tipos de contribui莽玫es

- **Corre莽玫es de bugs:** abordando problemas de c贸digo.
- **Novos recursos:** adicionando funcionalidade.
- **Documenta莽茫o:** melhorando guias e clareza.

### Abordagem de primeiro a issue

Todas as contribui莽玫es come莽am com uma Issue do GitHub usando nossos modelos simplificados.

- **Verifique as issues existentes**: Pesquise nas [Issues do GitHub](https://github.com/tocodex-ai/tocodex-community/issues).
- **Crie uma issue** usando:
    - **Melhorias:** modelo "Solicita莽茫o de melhoria" (linguagem simples focada no benef铆cio do usu谩rio).
    - **Bugs:** modelo "Relat贸rio de bug" (reprodu莽茫o m铆nima + esperado vs. real + vers茫o).
- **Quer trabalhar nisso?** Comente "Reivindicando" na issue e envie uma DM para **Hannes Rudolph (`hrudolph`)** no [Discord](https://github.com/tocodex-ai/tocodex-community/issues) para ser atribu铆do. A atribui莽茫o ser谩 confirmada no t贸pico.
- **Os PRs devem ser vinculados 脿 issue.** PRs n茫o vinculados podem ser fechados.

### Decidindo no que trabalhar

- Verifique o [Projeto do GitHub](https://github.com/tocodex-ai/tocodex-community/issues) para issues "Issue [N茫o atribu铆da]".
- Para documenta莽茫o, visite [Documenta莽茫o do Roo Code](https://github.com/tocodex-ai/tocodex-community).

### Relatando bugs

- Verifique primeiro os relat贸rios existentes.
- Crie um novo bug usando o [modelo "Relat贸rio de bug"](https://github.com/tocodex-ai/tocodex-community/issues/new/choose) com:
    - Passos de reprodu莽茫o claros e numerados
    - Resultado esperado vs. real
    - Vers茫o do Roo Code (obrigat贸rio); provedor/modelo de IA, se relevante
- **Problemas de seguran莽a**: Relate em particular atrav茅s de [avisos de seguran莽a](https://github.com/tocodex-ai/tocodex-community/security/advisories/new).

## Processo de desenvolvimento e envio

### Configura莽茫o de desenvolvimento

1. **Fork e Clone:**

```
git clone https://github.com/SEU_NOME_DE_USUARIO/Roo-Code.git
```

2. **Instale as depend锚ncias:**

```
pnpm install
```

3. **Depura莽茫o:** Abra com o VS Code (`F5`).

### Diretrizes para escrever c贸digo

- Um PR focado por recurso ou corre莽茫o.
- Siga as melhores pr谩ticas do ESLint e TypeScript.
- Escreva commits claros e descritivos referenciando issues (por exemplo, `Corrige #123`).
- Forne莽a testes completos (`npm test`).
- Fa莽a o rebase para o branch `main` mais recente antes do envio.

### Enviando uma Pull Request

- Comece como um **PR de rascunho** se estiver buscando feedback inicial.
- Descreva claramente suas altera莽玫es seguindo o Modelo de Pull Request.
- Vincule a issue na descri莽茫o/t铆tulo do PR (por exemplo, "Corrige #123").
- Forne莽a capturas de tela/v铆deos para altera莽玫es na interface do usu谩rio.
- Indique se as atualiza莽玫es da documenta莽茫o s茫o necess谩rias.

### Pol铆tica de Pull Request

- Deve fazer refer锚ncia a uma Issue do GitHub atribu铆da. Para ser atribu铆do: comente "Reivindicando" na issue e envie uma DM para **Hannes Rudolph (`hrudolph`)** no [Discord](https://github.com/tocodex-ai/tocodex-community/issues). A atribui莽茫o ser谩 confirmada no t贸pico.
- PRs n茫o vinculados podem ser fechados.
- Os PRs devem passar nos testes de CI, estar alinhados com o roteiro e ter documenta莽茫o clara.

### Processo de revis茫o

- **Triagem di谩ria:** verifica莽玫es r谩pidas pelos mantenedores.
- **Revis茫o aprofundada semanal:** avalia莽茫o abrangente.
- **Itere prontamente** com base no feedback.

## Legal

Ao contribuir, voc锚 concorda que suas contribui莽玫es ser茫o licenciadas sob a Licen莽a Apache 2.0, consistente com o licenciamento do Roo Code.
