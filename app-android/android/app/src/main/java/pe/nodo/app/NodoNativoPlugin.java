package pe.nodo.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Datos del APK para la app web: si trae Firebase (avisos con la app cerrada) y su versión.
@CapacitorPlugin(name = "NodoNativo")
public class NodoNativoPlugin extends Plugin {
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
