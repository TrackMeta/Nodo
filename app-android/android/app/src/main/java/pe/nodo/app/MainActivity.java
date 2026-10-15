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
    // Relevo sin salto entre la pantalla de inicio de Android y la carga de la app: Android la quitaba apenas la app
    // dibujaba algo, a veces con la N a medio dibujar y antes de que apareciera la carga web. Ahora se queda hasta que
    // la página avisa que su carga ya está (NodoNativo.bootListo) y la N terminó (0,95 s); como mucho 2,5 s.
    static final long N_COMPLETA = 950, TOPE = 2500;
    static volatile boolean bootListo = false;
    static volatile long t0 = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        t0 = android.os.SystemClock.uptimeMillis();
        bootListo = false;
        // Plugin propio: le dice a la app web si este APK trae Firebase (sin él, registrar avisos cerraría la app).
        registerPlugin(NodoNativoPlugin.class);
        super.onCreate(savedInstanceState);
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            final android.view.View content = findViewById(android.R.id.content);
            content.getViewTreeObserver().addOnPreDrawListener(new android.view.ViewTreeObserver.OnPreDrawListener() {
                @Override
                public boolean onPreDraw() {
                    long e = android.os.SystemClock.uptimeMillis() - t0;
                    if ((bootListo && e >= N_COMPLETA) || e >= TOPE) {
                        content.getViewTreeObserver().removeOnPreDrawListener(this);
                        return true;
                    }
                    return false;   // todavía no: Android sigue mostrando su pantalla de inicio
                }
            });
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
