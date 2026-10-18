# Despliegue SEGURO de las Edge Functions de Nodo (auditoría 18-oct).
#
# Qué hace, en orden:
#   1. Elige QUÉ funciones subir: las que empaquetan algún archivo que cambió (grafo de imports en
#      tools/funciones-afectadas.mjs). Antes era una lista fija de 17 de 34 y las otras se quedaban con código viejo.
#   2. CORRECTOR: `deno check` de esas funciones. Frena (no sube NADA) si hay un error de los que tumban el bot:
#      sintaxis, nombre o import que no existe, constante repetida (el 503 «bot mudo»). Los avisos de tipos que el
#      código ya tenía (TS2339 y compañía) no frenan.
#   3. Sube cada función con su verify_jwt ACTUAL de producción (se lee de la API antes de subir): config.toml no
#      siempre coincide con lo que corre, y cambiarlo sin querer rompe webhooks (Telegram, Meta) o el panel.
#   4. Verifica: ninguna puede responder 503 (no compila) y el verify_jwt tiene que seguir igual.
#   5. Anota el commit desplegado en tools/.ultimo-despliegue (local, no va a git) para la próxima vez.
#
# Uso (desde cualquier carpeta):
#   powershell -File tools\desplegar.ps1                  # lo que cambió desde el último despliegue (+ cambios sin commit)
#   powershell -File tools\desplegar.ps1 -Todas           # las 34
#   powershell -File tools\desplegar.ps1 -Solo scheduler,webchat
#   powershell -File tools\desplegar.ps1 -SoloRevisar     # solo el corrector, no sube nada
#   powershell -File tools\desplegar.ps1 -SoloVerificar   # solo el chequeo de 503 de las funciones elegidas
#
# El token de Supabase se lee de la ranura propia de Nodo en el Credential Manager («Supabase CLI:nodo») y se pasa
# solo a este proceso: `supabase login` de otra cuenta pisa la ranura compartida y Nodo empezaba a dar 403.
param([switch]$Todas, [string[]]$Solo, [switch]$SoloRevisar, [switch]$SoloVerificar)
$ErrorActionPreference = "Continue"   # (con "Stop", PS 5.1 corta cuando un programa escribe en stderr, y deno escribe ahí su progreso)
$env:NO_COLOR = "1"
$RAIZ = Split-Path -Parent $PSScriptRoot
$REF = "ahoxdyffbwjlshmdezwi"
$MARCA = Join-Path $PSScriptRoot ".ultimo-despliegue"

# ── 1. Qué funciones ──────────────────────────────────────────────────────────
Push-Location $RAIZ
try {
  $todasLas = (& node tools/funciones-afectadas.mjs | ForEach-Object { ($_ -split '\s+')[0] }) | Where-Object { $_ }
  if ($Todas) { $FN = $todasLas }
  elseif ($Solo) { $FN = $Solo | ForEach-Object { $_ -split ',' } | Where-Object { $_ } }
  else {
    $desde = if (Test-Path $MARCA) { (Get-Content $MARCA -Raw).Trim() } else { $null }
    if (-not $desde) { "No hay registro del último despliegue: se suben TODAS."; $FN = $todasLas }
    else {
      $cambiados = @(& git diff --name-only $desde -- supabase/functions) + @(& git diff --name-only HEAD -- supabase/functions) | Sort-Object -Unique
      $FN = if ($cambiados.Count) { & node tools/funciones-afectadas.mjs @cambiados } else { @() }
      "Cambios desde $($desde.Substring(0,7)): $($cambiados.Count) archivo(s)."
    }
  }
  $FN = @($FN | Where-Object { $_ })
  if (-not $FN.Count) { "Nada que desplegar."; exit 0 }
  "Funciones ($($FN.Count)): $($FN -join ', ')"

  # ── 2. Corrector ────────────────────────────────────────────────────────────
  if (-not $SoloVerificar) {
    "=== corrector (deno check) ==="
    # El mismo corrector que corre GitHub en cada push (tools/revisar-funciones.mjs): una sola lista de errores graves.
    & node tools/revisar-funciones.mjs ($FN -join ",")
    if ($LASTEXITCODE -ne 0) { "No se subió nada."; exit 2 }
    if ($SoloRevisar) { exit 0 }
  }

  # ── Token (ranura propia de Nodo) ────────────────────────────────────────────
  $src = @"
using System;using System.Text;using System.Runtime.InteropServices;
public class CredNodoDep {
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 struct CREDENTIAL { public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
   public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
   public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
 public static string Get(string target){
   IntPtr p; if(!CredRead(target,1,0,out p)) return null;
   CREDENTIAL c=(CREDENTIAL)Marshal.PtrToStructure(p,typeof(CREDENTIAL));
   byte[] b=new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob,b,0,(int)c.CredentialBlobSize);
   if(b.Length>1 && b[1]==0) return Encoding.Unicode.GetString(b);
   return Encoding.UTF8.GetString(b);
 }
}
"@
  try { Add-Type -TypeDefinition $src -Language CSharp | Out-Null } catch { }
  $tok = [CredNodoDep]::Get("Supabase CLI:nodo")
  if (-not $tok) { $tok = [CredNodoDep]::Get("Supabase CLI:supabase") }
  if (-not $tok) { "SIN TOKEN en el Credential Manager"; exit 1 }
  $tok = $tok.Trim()
  $env:SUPABASE_ACCESS_TOKEN = $tok
  function Get-Funciones {
    $r = Invoke-WebRequest -Uri "https://api.supabase.com/v1/projects/$REF/functions" -UseBasicParsing -Headers @{ Authorization = "Bearer $tok" }
    ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json)
  }

  # ── 3. Subir, cada una con su verify_jwt actual ──────────────────────────────
  $prod = @{}; foreach ($f in Get-Funciones) { $prod[$f.slug] = [bool]$f.verify_jwt }
  if (-not $SoloVerificar) {
    "=== subiendo ==="
    $fallos = 0
    foreach ($f in $FN) {
      $argsDep = @('functions', 'deploy', $f, '--project-ref', $REF)
      if ($prod.ContainsKey($f)) { if (-not $prod[$f]) { $argsDep += '--no-verify-jwt' } }
      else { "  (nueva: $f se sube SIN verify_jwt; si debe pedir sesión de Supabase, cámbialo en el Dashboard)"; $argsDep += '--no-verify-jwt' }
      $r = (& supabase @argsDep 2>&1 | Select-Object -Last 3) -join " "
      if ($r -match "Deployed Functions") { "OK    $f" } else { "FALLO $f :: $r"; $fallos++ }
    }
  }

  # ── 4. Verificación ─────────────────────────────────────────────────────────
  # El deploy dice «Deployed» aunque el bundle no arranque: un POST vacío tiene que dar 200/400/401/403/404, nunca 503.
  "=== verificación (503 = no arranca) ==="
  $caidas = 0
  foreach ($f in $FN) {
    try {
      $r = Invoke-WebRequest -Uri "https://$REF.supabase.co/functions/v1/$f" -Method Post -UseBasicParsing `
           -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes("{}"))
      $c = $r.StatusCode
    } catch { $c = $_.Exception.Response.StatusCode.value__ }
    if ($c -eq 503) { "{0,-18} {1}  <<< NO ARRANCA" -f $f, $c; $caidas++ } else { "{0,-18} {1}" -f $f, $c }
  }
  $despues = @{}; foreach ($x in Get-Funciones) { $despues[$x.slug] = [bool]$x.verify_jwt }
  $cambioJwt = @($FN | Where-Object { $prod.ContainsKey($_) -and $despues[$_] -ne $prod[$_] })
  if ($cambioJwt.Count) { "ATENCIÓN: cambió el verify_jwt de: $($cambioJwt -join ', ')"; $caidas++ }

  if ($SoloVerificar) { exit ([int]($caidas -gt 0)) }
  if ($caidas -or $fallos) { "TERMINÓ CON PROBLEMAS (subidas fallidas: $fallos, caídas/cambios: $caidas)."; exit 3 }
  # ── 5. Marca del último despliegue completo y sano ───────────────────────────
  if (-not $Solo) { (& git rev-parse HEAD) | Set-Content -Path $MARCA -Encoding ascii }
  "LISTO: $($FN.Count) función(es) desplegada(s) y respondiendo."
} finally { Pop-Location }
