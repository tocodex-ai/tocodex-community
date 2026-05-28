<div align="center">
<sub>

[English](../../CONTRIBUTING.md) 鈥?[Catal脿](../ca/CONTRIBUTING.md) 鈥?[Deutsch](../de/CONTRIBUTING.md) 鈥?<b>Espa帽ol</b> 鈥?[Fran莽ais](../fr/CONTRIBUTING.md) 鈥?[啶灌た啶傕う啷€](../hi/CONTRIBUTING.md) 鈥?[Bahasa Indonesia](../id/CONTRIBUTING.md) 鈥?[Italiano](../it/CONTRIBUTING.md) 鈥?[鏃ユ湰瑾瀅(../ja/CONTRIBUTING.md)

</sub>
<sub>

[頃滉淡鞏碷(../ko/CONTRIBUTING.md) 鈥?[Nederlands](../nl/CONTRIBUTING.md) 鈥?[Polski](../pl/CONTRIBUTING.md) 鈥?[Portugu锚s (BR)](../pt-BR/CONTRIBUTING.md) 鈥?[袪褍褋褋泻懈泄](../ru/CONTRIBUTING.md) 鈥?[T眉rk莽e](../tr/CONTRIBUTING.md) 鈥?[Ti岷縩g Vi峄噒](../vi/CONTRIBUTING.md) 鈥?[绠€浣撲腑鏂嘳(../zh-CN/CONTRIBUTING.md) 鈥?[绻侀珨涓枃](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuir a Roo Code

Roo Code es un proyecto impulsado por la comunidad y valoramos profundamente cada contribuci贸n. Para agilizar la colaboraci贸n, operamos con un [enfoque de "primero la incidencia"](#enfoque-de-primero-la-incidencia), lo que significa que todas las [solicitudes de extracci贸n (PR)](#env铆o-de-una-solicitud-de-extracci贸n) deben estar primero vinculadas a una incidencia de GitHub. Por favor, revise esta gu铆a detenidamente.

## Tabla de contenidos

- [Antes de contribuir](#antes-de-contribuir)
- [Encontrar y planificar su contribuci贸n](#encontrar-y-planificar-su-contribuci贸n)
- [Proceso de desarrollo y env铆o](#proceso-de-desarrollo-y-env铆o)
- [Legal](#legal)

## Antes de contribuir

### 1. C贸digo de conducta

Todos los colaboradores deben adherirse a nuestro [C贸digo de conducta](./CODE_OF_CONDUCT.md).

### 2. Hoja de ruta del proyecto

Nuestra hoja de ruta gu铆a la direcci贸n del proyecto. Alinee sus contribuciones con estos objetivos clave:

### La fiabilidad es lo primero

- Aseg煤rese de que la edici贸n de diferencias y la ejecuci贸n de comandos sean consistentemente fiables.
- Reduzca los puntos de fricci贸n que desalientan el uso regular.
- Garantice un funcionamiento fluido en todas las localidades y plataformas.
- Ampl铆e el soporte robusto para una amplia variedad de proveedores y modelos de IA.

### Experiencia de usuario mejorada

- Agilice la interfaz de usuario/experiencia de usuario para mayor claridad e intuici贸n.
- Mejore continuamente el flujo de trabajo para cumplir con las altas expectativas que los desarrolladores tienen de las herramientas de uso diario.

### Liderando el rendimiento de los agentes

- Establezca puntos de referencia de evaluaci贸n (evals) exhaustivos para medir la productividad en el mundo real.
- Facilite que todos puedan ejecutar e interpretar f谩cilmente estas evaluaciones.
- Env铆e mejoras que demuestren un claro aumento en las puntuaciones de las evaluaciones.

Mencione la alineaci贸n con estas 谩reas en sus solicitudes de extracci贸n.

### 3. 脷nase a la comunidad de Roo Code

- **Principal:** 脷nase a nuestro [Discord](https://github.com/tocodex-ai/tocodex-community/issues) y env铆e un mensaje directo a **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** Los colaboradores experimentados pueden participar directamente a trav茅s de [Proyectos de GitHub](https://github.com/tocodex-ai/tocodex-community/issues).

## Encontrar y planificar su contribuci贸n

### Tipos de contribuciones

- **Correcciones de errores:** abordar problemas de c贸digo.
- **Nuevas caracter铆sticas:** agregar funcionalidad.
- **Documentaci贸n:** mejorar las gu铆as y la claridad.

### Enfoque de primero la incidencia

Todas las contribuciones comienzan con una incidencia de GitHub utilizando nuestras plantillas simplificadas.

- **Compruebe las incidencias existentes**: busque en [Incidencias de GitHub](https://github.com/tocodex-ai/tocodex-community/issues).
- **Cree una incidencia** utilizando:
    - **Mejoras:** plantilla "Solicitud de mejora" (lenguaje sencillo centrado en el beneficio del usuario).
    - **Errores:** plantilla "Informe de error" (reproducci贸n m铆nima + esperado vs. real + versi贸n).
- **驴Quiere trabajar en ello?** Comente "Reclamando" en la incidencia y env铆e un mensaje directo a **Hannes Rudolph (`hrudolph`)** en [Discord](https://github.com/tocodex-ai/tocodex-community/issues) para que se le asigne. La asignaci贸n se confirmar谩 en el hilo.
- **Las solicitudes de extracci贸n deben enlazar a la incidencia.** Las solicitudes de extracci贸n no enlazadas pueden cerrarse.

### Decidir en qu茅 trabajar

- Consulte el [Proyecto de GitHub](https://github.com/tocodex-ai/tocodex-community/issues) para ver las incidencias "Incidencia [Sin asignar]".
- Para la documentaci贸n, visite [Documentos de Roo Code](https://github.com/tocodex-ai/tocodex-community).

### Informar de errores

- Compruebe primero si existen informes.
- Cree un nuevo error utilizando la [plantilla "Informe de error"](https://github.com/tocodex-ai/tocodex-community/issues/new/choose) con:
    - Pasos de reproducci贸n claros y numerados
    - Resultado esperado vs. real
    - Versi贸n de Roo Code (obligatorio); proveedor/modelo de API si es relevante
- **Problemas de seguridad**: informe de forma privada a trav茅s de [avisos de seguridad](https://github.com/tocodex-ai/tocodex-community/security/advisories/new).

## Proceso de desarrollo y env铆o

### Configuraci贸n de desarrollo

1. **Bifurcar y clonar:**

```
git clone https://github.com/SU_NOMBRE_DE_USUARIO/Roo-Code.git
```

2. **Instalar dependencias:**

```
pnpm install
```

3. **Depuraci贸n:** Abra con VS Code (`F5`).

### Directrices para escribir c贸digo

- Una solicitud de extracci贸n centrada por caracter铆stica o correcci贸n.
- Siga las mejores pr谩cticas de ESLint y TypeScript.
- Escriba confirmaciones claras y descriptivas que hagan referencia a las incidencias (p. ej., `Corrige #123`).
- Proporcione pruebas exhaustivas (`npm test`).
- Rebase a la rama `main` m谩s reciente antes del env铆o.

### Env铆o de una solicitud de extracci贸n

- Comience como una **PR en borrador** si busca comentarios tempranos.
- Describa claramente sus cambios siguiendo la plantilla de solicitud de extracci贸n.
- Enlace la incidencia en la descripci贸n/t铆tulo de la PR (p. ej., "Corrige #123").
- Proporcione capturas de pantalla/v铆deos para los cambios en la interfaz de usuario.
- Indique si es necesario actualizar la documentaci贸n.

### Pol铆tica de solicitud de extracci贸n

- Debe hacer referencia a una incidencia de GitHub asignada. Para que se le asigne: comente "Reclamando" en la incidencia y env铆e un mensaje directo a **Hannes Rudolph (`hrudolph`)** en [Discord](https://github.com/tocodex-ai/tocodex-community/issues). La asignaci贸n se confirmar谩 en el hilo.
- Las solicitudes de extracci贸n no enlazadas pueden cerrarse.
- Las solicitudes de extracci贸n deben pasar las pruebas de CI, estar alineadas con la hoja de ruta y tener una documentaci贸n clara.

### Proceso de revisi贸n

- **Clasificaci贸n diaria:** comprobaciones r谩pidas por parte de los mantenedores.
- **Revisi贸n semanal en profundidad:** evaluaci贸n exhaustiva.
- **Itere r谩pidamente** en funci贸n de los comentarios.

## Legal

Al contribuir, acepta que sus contribuciones se licenciar谩n bajo la Licencia Apache 2.0, de acuerdo con la licencia de Roo Code.
