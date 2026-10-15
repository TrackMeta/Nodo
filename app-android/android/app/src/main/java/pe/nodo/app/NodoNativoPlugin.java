package pe.nodo.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Datos del APK para la app web: si trae Firebase (avisos con la app cerrada) y su versión.
@CapacitorPlugin(name = "NodoNativo")
public class NodoNativoPlugin extends Plugin {
    // Barras del celular (arriba: hora/señal; abajo: navegación). Con Android 15 la app va de borde a borde y
    // el color de la barra ya no se puede pintar: lo que se ve detrás es el fondo de la ventana. Se pinta ese
    // fondo del color de la cabecera y se eligen íconos claros u oscuros según el tema.
    @PluginMethod
    public void barras(PluginCall call) {
        final String color = call.getString("color", "#131A26");
        final boolean claro = Boolean.TRUE.equals(call.getBoolean("claro", false));
        getActivity().runOnUiThread(() -> {
            try {
                android.view.Window w = getActivity().getWindow();
                int c = android.graphics.Color.parseColor(color);
                w.getDecorView().setBackgroundColor(c);
                w.setStatusBarColor(c);
                w.setNavigationBarColor(c);
                androidx.core.view.WindowInsetsControllerCompat ic = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
                ic.setAppearanceLightStatusBars(claro);
                ic.setAppearanceLightNavigationBars(claro);
                // Se recuerda el tema: la próxima vez que abras la app, el fondo nativo (y la pantalla de inicio de
                // Android 13+) ya sale de tu color, sin el destello oscuro antes de que cargue la página.
                getContext().getSharedPreferences(MainActivity.PREFS, android.content.Context.MODE_PRIVATE).edit()
                    .putInt("fondo", c).putBoolean("claro", claro).apply();
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    getActivity().getSplashScreen().setSplashScreenTheme(claro ? R.style.NodoInicioClaro : R.style.NodoInicioOscuro);
                }
                call.resolve();
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            }
        });
    }

    // La carga web ya está en pantalla: Android puede soltar su pantalla de inicio (cuando la N terminó). Devuelve
    // cuántos ms faltan para que se vea la página, así la carga arma el logo justo cuando aparece y no detrás.
    @PluginMethod
    public void bootListo(PluginCall call) {
        MainActivity.bootListo = true;
        long e = android.os.SystemClock.uptimeMillis() - MainActivity.t0;
        JSObject r = new JSObject();
        r.put("espera", Math.max(0, MainActivity.N_COMPLETA - e));
        // v2 (APK 1.0.13+): la pantalla de Android ya trae el cuadro armado y la N blanca; la carga web sigue quieta
        r.put("v", 2);
        call.resolve(r);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        boolean firebase = false;
        try {
            // Por reflexión: Firebase llega con el plugin de avisos y no está en el classpath de la app.
            Class<?> fb = Class.forName("com.google.firebase.FirebaseApp");
            Object apps = fb.getMethod("getApps", android.content.Context.class).invoke(null, getContext());
            firebase = apps instanceof java.util.List && !((java.util.List<?>) apps).isEmpty();
        } catch (Throwable t) {
            firebase = false;
        }
        r.put("firebase", firebase);
        r.put("version", BuildConfig.VERSION_NAME);
        r.put("build", BuildConfig.VERSION_CODE);
        call.resolve(r);
    }
}
