# APK de Nodo (Android)

Envoltorio [Capacitor](https://capacitorjs.com) que abre la app web de `panel/app/`
(publicada en https://trackmeta.github.io/Nodo/panel/app/). La app web se actualiza sola con cada
push a `main`; **solo hace falta un APK nuevo** si cambia algo de esta carpeta (permisos, ícono,
sonidos, plugins).

- **Armar:** GitHub → Actions → «APK de Nodo» → Run workflow (o cualquier push que toque `app-android/`).
  El APK queda en *Artifacts* de esa corrida.
- **Secretos de GitHub:** `GOOGLE_SERVICES_JSON` (Firebase, avisos con la app cerrada) y
  `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASS` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASS`
  (firma). Sin la firma sale un APK de prueba que para actualizar hay que desinstalar.
- **La llave de firma** no está en el repo (es público): vive en `.llaves-app/` de la compu de Rodrigo.
- **Servidor de avisos:** función `supabase/functions/push` + migración `0137_push_app.sql`; necesita el
  secreto `FCM_SERVICE_ACCOUNT` en Supabase.
- `tools-sonidos.js` genera los sonidos de los avisos (`res/raw`).
