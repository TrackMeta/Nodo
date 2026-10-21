package pe.nodo.app;

import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.graphics.drawable.Animatable;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewGroup.MarginLayoutParams;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    static final String PREFS = "nodo";
    // ── Pantalla de inicio NATIVA (APK 1.0.16, 20-oct, como Vendia) ──────────────────────────────────────────────
    // Antes la carga se repartía: Android dibujaba la «Red de nodos» en su pantalla de inicio y se la pasaba a la
    // página, que seguía con su copia del logo, los textos y el fundido MIENTRAS cargaba la app → tirones. Ahora la
    // pantalla del sistema es solo el fondo, y la animación entera vive en una capa nativa encima de la app:
    //   1) la «Red de nodos» (drawable/splash_n, animated-vector: la dibuja el hilo de render, nunca se traba),
    //   2) el logo late suave mientras la app termina de cargar debajo,
    //   3) cuando la página avisa que ya se ve (NodoNativo.bootListo) crece un poco y la capa se desvanece.
    // La página sabe que no debe animar nada por la marca «NodoInicioNativo/1» del user agent (capacitor.config.json).
    static final long N_COMPLETA = 1450;   // la «Red de nodos» + el cuadro + la N blanca
    static final long TOPE = 10000;        // nunca se queda pegada
    static volatile long t0 = 0;
    private final Handler h = new Handler(Looper.getMainLooper());
    private FrameLayout inicio;
    private ImageView inicioLogo;
    private ObjectAnimator latido;
    private boolean appLista = false, cerrando = false;

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void mostrarInicio(int fondo) {
        inicio = new FrameLayout(this);
        inicio.setBackgroundColor(fondo);
        inicio.setClickable(true);   // nada se toca por debajo mientras carga
        inicioLogo = new ImageView(this);
        Drawable n = ContextCompat.getDrawable(this, R.drawable.splash_n);
        inicioLogo.setImageDrawable(n);
        // 288 dp: el tamaño del ícono de la pantalla de inicio de Android para el que se dibujó (logo de ~104 dp)
        inicio.addView(inicioLogo, new FrameLayout.LayoutParams(dp(288), dp(288), Gravity.CENTER));
        ((ViewGroup) getWindow().getDecorView()).addView(inicio,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (n instanceof Animatable) ((Animatable) n).start();
        h.postDelayed(this::latir, N_COMPLETA);
        h.postDelayed(() -> cerrarInicio(true), TOPE);
    }

    // 2) Mientras carga: late suave (como la V de Vendia)
    private void latir() {
        if (cerrando || inicioLogo == null) return;
        if (appLista) { cerrarInicio(false); return; }
        latido = ObjectAnimator.ofPropertyValuesHolder(inicioLogo,
            PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.06f),
            PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.06f));
        latido.setDuration(560);
        latido.setRepeatCount(ValueAnimator.INFINITE);
        latido.setRepeatMode(ValueAnimator.REVERSE);
        latido.setInterpolator(new AccelerateDecelerateInterpolator());
        latido.start();
    }

    // La página avisa que la app ya se ve (NodoNativo.bootListo): se cierra apenas terminó la «Red de nodos»
    void appLista() {
        runOnUiThread(() -> {
            appLista = true;
            if (SystemClock.uptimeMillis() - t0 >= N_COMPLETA) cerrarInicio(false);
            // si la N todavía se está armando, latir() la cierra al terminar (sin latido)
        });
    }

    // 3) Crece un poco y la capa se desvanece hacia la app
    private void cerrarInicio(boolean forzado) {
        if (inicio == null || cerrando) return;
        if (!forzado && SystemClock.uptimeMillis() - t0 < N_COMPLETA) return;
        cerrando = true;
        h.removeCallbacksAndMessages(null);
        if (latido != null) latido.cancel();
        final FrameLayout capa = inicio;
        inicioLogo.animate().scaleX(1.35f).scaleY(1.35f).setDuration(380).setInterpolator(new AccelerateInterpolator()).withLayer().start();
        capa.animate().alpha(0f).setDuration(380).withLayer().withEndAction(() -> {
            ViewGroup padre = (ViewGroup) capa.getParent();
            if (padre != null) padre.removeView(capa);
            inicio = null;
            inicioLogo = null;
        }).start();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        t0 = SystemClock.uptimeMillis();
        // Plugin propio: le dice a la app web si este APK trae Firebase (sin él, registrar avisos cerraría la app).
        registerPlugin(NodoNativoPlugin.class);
        super.onCreate(savedInstanceState);
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        // El tema que elegiste (lo guarda NodoNativo.barras): fondo de la ventana, de la página, de la carga y barras de
        // tu color desde el primer instante, antes de que cargue la app.
        int fondo = ContextCompat.getColor(this, R.color.nodo_fondo);
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (sp.contains("fondo")) {
            try {
                int c = sp.getInt("fondo", 0xFF131A26);
                boolean claro = sp.getBoolean("claro", false);
                fondo = c;
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
        // Al girar el celular o si Android recrea la pantalla, no se repite
        if (savedInstanceState == null) mostrarInicio(fondo);
        // Respaldo si la página no avisa (sin internet, página de error, una versión vieja en caché)
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) { h.postDelayed(() -> cerrarInicio(true), 6000); }
                @Override
                public void onReceivedError(WebView webView) { h.postDelayed(() -> cerrarInicio(true), 1500); }
            });
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
