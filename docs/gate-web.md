# El gate de velocidad y accesibilidad

`npm run gate:web` · corre en cada PR desde `.github/workflows/calidad-web.yml`.

«La web tiene que ir rápida» era un requisito del encargo, y hasta F7 no había
forma de que dejara de cumplirse sin que nadie se enterara. Esto lo convierte en
algo que **falla una PR**.

## Qué hace

Arranca el servidor **real ya construido** y le hace preguntas por HTTP —
`npm run build` antes, o no hay `dist/` que arrancar. Se
lanza **sin `DATABASE_URL` a propósito**: así sirve la semilla, y la medida es
la misma hoy que dentro de seis meses — un gate cuyo resultado depende de
cuántas noticias haya publicadas ese día no sirve para comparar nada.

| Comprobación | Por qué |
|---|---|
| Peso comprimido de HTML, JS y CSS por página | El peso es la causa de casi todo lo demás, y se puede medir exacto |
| `s-maxage` y `ETag` en páginas públicas | Sin ellos cada visita se descarga entera |
| `no-store` + `noindex` en `/admin` | La redacción no va a una caché compartida ni a un buscador |
| `/healthz` sin `ETag` | Un estado de salud cacheado no es un estado de salud |
| Un solo `h1`, sin saltos de nivel | Quien navega por encabezados se pierde una sección sin enterarse |
| El `<html>` declara idioma | Sin `lang` el lector de pantalla pronuncia la página en el idioma equivocado |
| Todas las imágenes con `alt` | — |
| Todo control con etiqueta (`for`, envolvente o `aria-label`) | Las tres formas son válidas |
| La portada no referencia nada de `/admin` | El paquete de la redacción no puede filtrarse al público |

## Los presupuestos

Salen de **medir lo que hay** y dejar holgura para crecer, no de un número
redondo bonito: un presupuesto que ya se incumple el día que se escribe se
desactiva a la semana. Hoy la portada gasta ~5,9 KB de HTML, 1,8 de JS y 4,3 de
CSS comprimidos, con un techo de 14 / 6 / 6.

Si tu PR lo revienta, la pregunta no es «subo el número» sino **qué he metido**.
Subirlo es una decisión consciente que se explica en el commit.

## Qué NO mide

**LCP, CLS ni nada que necesite un navegador de verdad.** Eso es otro trabajo y
otro coste en CI, y una medida de tiempo en un runner compartido es ruidosa: un
gate que falla al azar se acaba ignorando, que es peor que no tenerlo. Aquí está
lo que se puede afirmar con certeza.

## Cómo se sabe que el gate funciona

Se rompió a propósito antes de darlo por bueno: un segundo `h1` y una etiqueta
quitada. Salida **1** con los tres fallos listados; restaurado, salida **0**.

De hecho, la primera vez que corrió encontró dos defectos reales en páginas ya
escritas —un salto `h1 → h3` en los listados— y un **falso positivo suyo**:
marcaba como error los `<label>` que envuelven su control, que son válidos. Se
arregló el gate, no las páginas.
