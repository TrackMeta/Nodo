package pe.nodo.app;

import android.os.Bundle;
import android.view.ViewGroup.MarginLayoutParams;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String PREFS = "nodo";
    // Relevo sin parpadeo entre la pantalla de inicio de Android y la carga de la app. Antes Android la quitaba sola y,
    // como la página todavía no había dibujado su primer cuadro (~0,4 s), por un instante no había nada debajo: destello.
    // Ahora Android le ENTREGA su pantalla a la app (setOnExitAnimationListener) y la app la deja encima mientras la
    // página dibuja la carga debajo; se quita recién cuando la página avisa que ya está en pantalla
    // (NodoNativo.bootListo) y la animación terminó (1,45 s: N + cuadro). Como mucho 2,8 s.
    static final long N_COMPLETA = 1450, TOPE = 2800;
    static volatile boolean bootListo = false;
    static volatile long t0 = 0;
    static volatile long bootListoEn = 0;   // la página recibe la respuesta, pone el logo armado y lo dibuja: 0,15 s de margen
    private android.view.View pantallaInicio = null;
    private final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());

    private void quitarInicioSiToca() {
        if (pantallaInicio == null) return;
        long e = android.os.SystemClock.uptimeMillis() - t0;
        long ahora = android.os.SystemClock.uptimeMillis();
        if ((bootListo && e >= N_COMPLETA && ahora - bootListoEn >= 150) || e >= TOPE) {
            final android.view.View v = pantallaInicio; pantallaInicio = null;
            // Debajo ya está el mismo logo en el mismo lugar: un fundido corto basta
            v.animate().alpha(0f).setDuration(120).withEndAction(() -> {
                if (android.os.Build.VERSION.SDK_INT >= 31 && v instanceof android.window.SplashScreenView) ((android.window.SplashScreenView) v).remove();
            }).start();
            return;
        }
        h.postDelayed(this::quitarInicioSiToca, 30);
    }

    // Dónde está (y de qué tamaño) el logo de la pantalla de Android, medido respecto del centro de la página, en dp
    // (= px de la página): la carga web pone el suyo en ese mismo punto. Android lo centra en la pantalla ENTERA y la
    // página va entre la barra de arriba y la de abajo (que no miden lo mismo): sin esto el logo saltaba unos píxeles.
    // Devuelve {dx, dy, escala} o null. Llamar en el hilo de la pantalla.
    float[] ajusteLogo() {
        try {
            WebView wv = getBridge() != null ? getBridge().getWebView() : null;
            if (wv == null || wv.getHeight() == 0) return null;
            float d = getResources().getDisplayMetrics().density;
            int[] w = new int[2]; wv.getLocationOnScreen(w);
            float webCx = w[0] + wv.getWidth() / 2f, webCy = w[1] + wv.getHeight() / 2f;
            android.view.View icono = null;
            if (android.os.Build.VERSION.SDK_INT >= 31 && pantallaInicio instanceof android.window.SplashScreenView)
                icono = ((android.window.SplashScreenView) pantallaInicio).getIconView();
            float icCx, icCy, escala = 1f;
            if (icono != null && icono.getWidth() > 0) {
                int[] i = new int[2]; icono.getLocationOnScreen(i);
                icCx = i[0] + icono.getWidth() / 2f; icCy = i[1] + icono.getHeight() / 2f;
                escala = icono.getWidth() / (288f * d);   // el dibujo se pensó para un ícono de 288 dp
                if (escala < 0.6f || escala > 1.6f) escala = 1f;
            } else {
                android.view.View deco = getWindow().getDecorView(); int[] dd = new int[2]; deco.getLocationOnScreen(dd);
                icCx = dd[0] + deco.getWidth() / 2f; icCy = dd[1] + deco.getHeight() / 2f;
            }
            return new float[] { (icCx - webCx) / d, (icCy - webCy) / d, escala };
        } catch (Throwable t) { return null; }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        t0 = android.os.SystemClock.uptimeMillis();
        bootListo = false;
        // Plugin propio: le dice a la app web si este APK trae Firebase (sin él, registrar avisos cerraría la app).
        registerPlugin(NodoNativoPlugin.class);
        super.onCreate(savedInstanceState);
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            getSplashScreen().setOnExitAnimationListener(vista -> { pantallaInicio = vista; quitarInicioSiToca(); });
        }
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        // El tema que elegiste (lo guarda NodoNativo.barras): fondo de la ventana, de la página y barras de tu color
        // desde el primer instante, antes de que cargue la app.
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (sp.contains("fondo")) {
            try {
                int c = sp.getInt("fondo", 0xFF131A26);
                boolean claro = sp.getBoolean("claro", false);
                android.view.Window w = getWindow();
                w.getDecorView().setBackgroundColor(c);
                w.setStatusBarColor(c);
                w.setNavigationBarColor(c);
                androidx.core.view.WindowInsetsControllerCompat ic = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
                ic.setAppearanceLightStatusBars(claro);
                ic.setAppearanceLightNavigationBars(claro);
                if (wv != null) wv.setBackgroundColor(c);
            } catch (Throwable t) { /* sin tema guardado: el oscuro de siempre */ }
        }
        // Teclado: Capacitor deja márgenes para las barras del sistema (adjustMarginsForEdgeToEdge) pero no para el
        // teclado, y con Android 15 el teclado tapaba la hoja de abajo y la caja de escribir. Mismo cálculo + el teclado:
        // abajo se deja lo que sea más alto, la barra de navegación o el teclado, y la página se achica por encima.
        if (wv != null) {
            ViewCompat.setOnApplyWindowInsetsListener(wv, (v, wi) -> {
                Insets bars = wi.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                Insets ime = wi.getInsets(WindowInsetsCompat.Type.ime());
                MarginLayoutParams mlp = (MarginLayoutParams) v.getLayoutParams();
                mlp.leftMargin = bars.left;
                mlp.rightMargin = bars.right;
                mlp.topMargin = bars.top;
                mlp.bottomMargin = Math.max(bars.bottom, ime.bottom);
                v.setLayoutParams(mlp);
                return WindowInsetsCompat.CONSUMED;
            });
        }
    }
}
