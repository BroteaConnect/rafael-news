# La redacción: acceso, roles y arranque

/ admin es la parte privada del portal. No lleva **ni una línea de JavaScript**:
formularios que postean y redirigen. Además de ser menos que mantener, garantiza
que el paquete de la redacción no aparezca jamás en una página pública, porque
no existe.

## Cómo se entra

Solo por invitación. Un `owner` invita desde `/admin/invitar`; el enlace es de
un solo uso, caduca en 72 horas y quien lo recibe elige su contraseña y el
nombre con el que firma. Aceptar la invitación crea a la vez el usuario y su
ficha pública de autor: quien entra en una redacción viene a firmar.

## Roles

| | journalist | editor | owner |
|---|---|---|---|
| Editar su perfil público | ✅ | ✅ | ✅ |
| Escribir y editar sus borradores | ✅ | ✅ | ✅ |
| Editar lo de otros | — | ✅ | ✅ |
| Publicar y retirar de la web | — | ✅ | ✅ |
| Invitar | — | — | ✅ |

Los permisos se comprueban **en el servidor**, y en las noticias contra la
noticia concreta, no contra la pantalla. Que un enlace no aparezca en el panel
es cosmética: quien escriba la URL a mano se encuentra un 403.

## Escribir y publicar

`/admin/noticias` es el listado de la redacción, y enseña **todas** las
noticias, no solo las publicadas: el sentido de esa pantalla son precisamente
los borradores. Es una sola lista **agrupada por días** —como la web—, porque la
redacción piensa en jornadas: «¿qué hemos sacado hoy?». La cabecera de cada día
(«Hoy», «Ayer» o la fecha escrita, con cuántas hay) se queda pegada arriba
mientras se baja, así que nunca hay que subir para saber de qué día es lo que se
está mirando. Las publicadas se agrupan por su fecha de publicación y los
borradores por su última edición, que es la fecha que importa mientras no salen.
Quien puede editar lo de otros ve toda la redacción; el resto, solo lo suyo, y
el nombre del autor solo aparece cuando la noticia es de otra persona.

La fila **entera** abre el editor: no hay que apuntar a un enlace pequeño. Una
noticia publicada lleva además un «ver en la web» dentro de la fila, y al pasar
por encima la fila apaga su propio resaltado para que quede claro que ese enlace
lleva a otro sitio. Cada fila dice su estado con una palabra además de con un
color, porque un borrador y una publicada no pueden distinguirse solo por un
tono.

Si no hay ninguna noticia todavía, la pantalla no se limita a decir que está
vacía: explica que se puede guardar un borrador a medias y volver luego, y pone
el botón de empezar.

«Nueva noticia» crea el borrador y lleva directamente al editor,
`/admin/noticias/<id>`. El editor son **dos columnas**: a la izquierda se
escribe (titular, entradilla, cuerpo y la vista previa) y a la derecha se decide
—tema, relevancia, vídeo, guardar, el estado, publicar o retirar y el destacado— en una
columna que también se queda pegada al bajar, para no tener que recorrer el
cuerpo entero y la vista previa hasta el botón que más se usa. En pantalla
estrecha queda todo en una columna y las decisiones van detrás del texto, que es
el orden en el que se trabaja. Ahí se hace todo:

- **Escribir**: titular, entradilla, tema, relevancia y cuerpo en markdown
  (`##` subtítulos, `**negrita**`, `*cursiva*`, listas, `>` cita, `[texto](enlace)`).
  El HTML que se escriba se escapa y se ve como texto: no hay forma de meter
  código en una noticia. Todavía no hay imágenes.
- **Un idioma cada vez**: la barra de idiomas cambia qué versión se está
  editando. Cada idioma es su propia fila, así que escribir la versión en inglés
  no pisa la española.
- **Ver cómo queda**: la vista previa usa el MISMO renderizado que se guarda, no
  una aproximación.
- **Poner un vídeo de YouTube**: en la columna de la derecha, debajo de la
  relevancia. Se puede pegar el enlace tal cual como venga —
  `youtube.com/watch?v=…`, `youtu.be/…`, un `/shorts/`, un `/live/`, el enlace
  de «insertar»— o el identificador suelto de 11 caracteres. De todo eso se
  guarda **solo el identificador**, así que da igual que el enlace traiga cola
  (`&t=`, `&list=`, `?si=`); el minuto de inicio no se guarda. Cuando ya hay uno
  puesto, al lado aparece un «verlo en YouTube» para comprobar de un vistazo que
  es el vídeo que se quería. **Para quitarlo, se vacía el campo y se guarda.**
  El vídeo es de la noticia, no de un idioma: es el mismo en español y en
  inglés, y se ve y se escribe igual desde cualquiera de las dos pestañas.
  Si lo que se pega no es de YouTube, la noticia **se guarda igual** —el texto
  no se pierde nunca por un enlace mal copiado—, se mantiene el vídeo que
  hubiera antes y el aviso lo dice; el campo conserva lo escrito para poder
  corregirlo.
  En la web el vídeo sale en la página de la noticia, entre la cabecera y el
  texto, y de entrada solo se ve un recuadro con el botón de reproducir: hasta
  que el lector no lo pulsa **no se pide nada a YouTube**, que es lo que
  permite seguir diciendo en `/legal` que no compartimos su navegación con
  terceros. Debajo del recuadro se avisa de que al darle a reproducir el vídeo
  se carga desde YouTube.
- **Publicar**: solo un editor o el responsable. La dirección de la noticia se
  calcula del titular en español **al publicar**, y republicar no la mueve: una
  URL que cambia después de compartida es un enlace roto. Sin titular no se
  publica, y si otra noticia ya tiene esa dirección se avisa en vez de inventar
  un número al final. Se puede marcar como noticia principal del día; el
  destacado anterior deja de serlo solo.
- **Retirar de la web**: vuelve a borrador y desaparece del portal al instante.
  **No borra nada** — retirar una noticia y perderla son cosas distintas.

Publicar se nota en la portada sin reconstruir ni reiniciar nada: se guarda en
las mismas tablas que lee la web, y el aviso de la base de datos refresca la
instantánea (los detalles, en
[architecture.md](./architecture.md#newsroom-write-path)).

Guardar lo hace quien haya pasado la comprobación de la noticia; publicar y
retirar exigen permiso, y sin él la acción no se ejecuta en silencio: la página
dice que no se puede.

## El primer responsable (arranque)

**No existe** —ni existirá— un camino tipo «si no hay usuarios, el primero que
llegue se hace owner». Ese atajo es una vulnerabilidad clásica: basta con llegar
antes. El primer owner se crea insertando su invitación directamente en la base
de datos, que es una acción que ya exige acceso al servidor:

```bash
# 1. Generar el token y su hash (el token EN CLARO no se guarda en ningún sitio)
TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('$TOKEN').digest('hex'))")

# 2. Insertar la invitación (72 h)
psql "$DATABASE_URL" -c "INSERT INTO invites (email, role, token_hash, expires_at)
  VALUES ('quien.manda@ejemplo.com', 'owner', '$HASH', now() + interval '72 hours')"

# 3. Entregar este enlace a esa persona, por un canal privado:
echo "https://rafael-news.brotea.dev/admin/aceptar?t=$TOKEN"
```

A partir de ahí, esa persona invita al resto desde la interfaz.

## Qué protege qué

- **Sesiones opacas en base de datos**, no JWT: hace falta poder revocar al
  instante. Suspender a alguien tiene que **echarlo si ya está dentro**, no solo
  impedirle volver — por eso la sesión comprueba el estado del usuario en cada
  petición.
- **`scrypt` de `node:crypto`**, con sal por usuario y los parámetros guardados
  junto al hash, para poder subir el coste mañana sin invalidar la contraseña de
  nadie. Ojo si se sube: scrypt necesita ~128·N·r bytes y el tope por defecto de
  Node son 32 MB, así que `maxmem` se calcula de N·r (con N=2¹⁵ y r=8 hacen falta
  33,5 MB, y sin subirlo **cada intento de entrada lanza**).
- **CSRF por doble envío** en todo POST, comparado en tiempo constante.
- **Mensajes de error genéricos**: si «no existe ese correo» y «contraseña
  incorrecta» se distinguieran, el formulario diría quién escribe en este medio.
  Por lo mismo, un correo inexistente también paga el coste de un scrypt: si no,
  el tiempo de respuesta lo delataría igual.
- **Cambiar la contraseña revoca todas las sesiones abiertas**: si te la robaron,
  cambiarla tiene que servir de algo.
- **Registro de auditoría** de entrada, salida, invitación y cambio de perfil.
  Cuando algo se publique mal, la pregunta será quién y cuándo.
