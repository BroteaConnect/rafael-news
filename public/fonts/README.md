# Fuentes de brotea-news

Ambas se redistribuyen bajo **SIL Open Font License 1.1**, que permite
incrustarlas y servirlas desde nuestro propio dominio (es justo lo que hace la
app: `public/fonts/`, sin CDN).

| Fichero | Familia | Autoría | Subset |
|---|---|---|---|
| `Newsreader-600-latin.woff2` | Newsreader | Production Type | latin, peso 600 · 23 KB |
| `Inter-var-latin.woff2` | Inter | Rasmus Andersson | latin, variable 400–700 · 47 KB |

Origen: los `.woff2` que sirve Google Fonts (`fonts.gstatic.com`) para el
bloque `/* latin */` de cada familia. El `unicode-range` de `../fonts.css` es
literalmente el que declara ese subset: un carácter fuera de él cae al
fallback en vez de provocar una descarga.

**Newsreader va en un solo peso, no variable, a propósito**: la variable con eje
óptico pesa 129 KB frente a 23 KB del peso suelto, y en titulares no
interpolamos. Inter sí va variable porque dos pesos sueltos suman 94 KB y la
variable 47 KB. Total: 70 KB en dos ficheros.

Si algún día hace falta recortar más, el siguiente paso es subsetear por
glifos usados (`pyftsubset`), no cambiar de familia.
