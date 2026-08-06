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
| Escribir y editar sus borradores (F6) | ✅ | ✅ | ✅ |
| Editar lo de otros (F6) | — | ✅ | ✅ |
| Publicar (F6) | — | ✅ | ✅ |
| Invitar | — | — | ✅ |

Los permisos se comprueban **en el servidor y por ruta**. Que un enlace no
aparezca en el panel es cosmética: quien escriba la URL a mano se encuentra un
403.

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
