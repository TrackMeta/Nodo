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

    // La app ya se ve (la página la dibujó debajo de la capa de inicio): la capa nativa de MainActivity crece y se
    // desvanece en cuanto termina la «Red de nodos». v 4 (APK 1.0.16+): la carga es 100 % nativa; la página no anima
    // nada (lo sabe por «NodoInicioNativo/1» en el user agent). «espera» = ms que faltan para que se vaya la capa.
    @PluginMethod
    public void bootListo(PluginCall call) {
        long e = android.os.SystemClock.uptimeMillis() - MainActivity.t0;
        JSObject r = new JSObject();
        r.put("espera", Math.max(0, MainActivity.N_COMPLETA - e) + 380);
        r.put("v", 4);
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).appLista();
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
