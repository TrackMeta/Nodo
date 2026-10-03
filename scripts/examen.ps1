# ═══════════════════════════════════════════════════════════════════
# Nodo · Correr el EXAMEN FIJO del bot de ventas (PLAN_MOTOR_IA.md, fase 0) desde la terminal.
#
#   powershell -File scripts/examen.ps1 -Etiqueta "línea base"
#   powershell -File scripts/examen.ps1 -Etiqueta "prueba" -Solo gatos,rodrigo     (solo esas)
#   powershell -File scripts/examen.ps1 -ExamenId <uuid>                           (ver / terminar uno)
#
# Llama a la Edge Function `examen` con la cabecera x-examen-secret. El secreto vive en el
# Administrador de credenciales de Windows («Nodo examen secreto») y en los secrets de Supabase
# (EXAMEN_SECRET); nunca en el repo. Corre 5 conversaciones a la vez; cada una avanza en varias
# llamadas si hace falta (la función corta antes de los ~150 s) y después la califica el juez.
# ═══════════════════════════════════════════════════════════════════
param(
  [string]$Etiqueta = "",
  [string]$Modelo = "",
  [string[]]$Solo = @(),
  [string]$ExamenId = "",
  [string]$ChannelId = "f5e85bad-11c1-41ac-99a4-77d59834de28",
  [int]$Paralelo = 5,
  [switch]$Rejuzgar,         # solo vuelve a calificar (no repite las conversaciones)
  [string]$Juez = "",        # modelo del juez (por defecto el de la función)
  [switch]$V2                # corre con el motor v2 (PLAN_MOTOR_IA, fase 1) solo para esta corrida
)
$ErrorActionPreference = "Stop"
$src = @"
using System;using System.Text;using System.Runtime.InteropServices;
public class CredEx {
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
$secret = [CredEx]::Get("Nodo examen secreto")
if (-not $secret) { Write-Output "Falta el secreto «Nodo examen secreto» en el Administrador de credenciales"; exit 1 }
$secret = $secret.Trim()
$url = "https://ahoxdyffbwjlshmdezwi.supabase.co/functions/v1/examen"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$llamar = {
  param($url, $secret, $obj)
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 6))
  try {
    $r = Invoke-WebRequest -Uri $url -Method Post -UseBasicParsing -TimeoutSec 170 -ContentType "application/json; charset=utf-8" `
      -Headers @{ "x-examen-secret" = $secret } -Body $bytes
    return ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json)
  } catch {
    $msg = $_.Exception.Message
    if ($_.Exception.Response) { try { $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $msg += " " + $sr.ReadToEnd() } catch {} }
    return [pscustomobject]@{ error = $msg }
  }
}

if (-not $ExamenId) {
  $ini = & $llamar $url $secret @{ accion = "iniciar"; channel_id = $ChannelId; etiqueta = $Etiqueta; modelo = $Modelo; v2 = [bool]$V2 }
  if ($ini.error) { Write-Output ("No se pudo iniciar: " + $ini.error); exit 1 }
  $ExamenId = $ini.examen_id
  $convs = @($ini.conversaciones | ForEach-Object { $_.conv })
  Write-Output ("Examen " + $ExamenId + " · " + $convs.Count + " conversaciones")
} else {
  $v = & $llamar $url $secret @{ accion = "ver"; examen_id = $ExamenId }
  $convs = if ($Rejuzgar) { @($v.conversaciones | ForEach-Object { $_.conv }) } else { @($v.conversaciones | Where-Object { $_.estado -ne "juzgada" } | ForEach-Object { $_.conv }) }
  Write-Output ("Retomando " + $ExamenId + " · faltan " + $convs.Count)
}
# (con -File, «-Solo gatos,lluvia» llega como UN texto: se separa por comas)
$Solo = @($Solo | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Solo.Count) { $convs = @($convs | Where-Object { $Solo -contains $_ }) }

# Cada trabajador: correr (en varias llamadas si hace falta) y después juzgar.
$trabajo = {
  param($url, $secret, $examenId, $conv, $llamarTxt, $soloJuzgar, $juez)
  $llamar = [scriptblock]::Create($llamarTxt)
  $estado = if ($soloJuzgar) { "corrida" } else { "?" }
  if (-not $soloJuzgar) { for ($k = 0; $k -lt 8; $k++) {
    $r = & $llamar $url $secret @{ accion = "correr"; examen_id = $examenId; conv = $conv }
    if ($r.error) { $estado = "error al correr: " + $r.error; break }
    if (-not $r.pendiente) { $estado = "corrida"; break }
  } }
  if ($estado -eq "corrida") {
    for ($k = 0; $k -lt 2; $k++) {
      $j = & $llamar $url $secret @{ accion = "juzgar"; examen_id = $examenId; conv = $conv; juez = $juez }
      if (-not $j.error) { $estado = "graves " + $j.graves + " · leves " + $j.leves; break }
      $estado = "error del juez: " + $j.error
    }
  }
  return ($conv + " → " + $estado)
}

$pool = [RunspaceFactory]::CreateRunspacePool(1, $Paralelo); $pool.Open()
$jobs = @()
foreach ($c in $convs) {
  $ps = [PowerShell]::Create(); $ps.RunspacePool = $pool
  [void]$ps.AddScript($trabajo).AddArgument($url).AddArgument($secret).AddArgument($ExamenId).AddArgument($c).AddArgument($llamar.ToString()).AddArgument([bool]$Rejuzgar).AddArgument($Juez)
  $jobs += [pscustomobject]@{ ps = $ps; h = $ps.BeginInvoke() }
}
foreach ($j in $jobs) { Write-Output ("  " + ($j.ps.EndInvoke($j.h) -join "")); $j.ps.Dispose() }
$pool.Close()

# Resumen
$v = & $llamar $url $secret @{ accion = "ver"; examen_id = $ExamenId }
$cs = @($v.conversaciones)
$juzg = @($cs | Where-Object { $_.estado -eq "juzgada" })
$graves = ($juzg | Measure-Object -Property graves -Sum).Sum
$leves = ($juzg | Measure-Object -Property leves -Sum).Sum
$conGrave = @($juzg | Where-Object { $_.graves -gt 0 }).Count
Write-Output ""
Write-Output ("NOTA · " + $juzg.Count + "/" + $cs.Count + " juzgadas · conversaciones con falla grave: " + $conGrave + " · graves: " + $graves + " · leves: " + $leves)
foreach ($c in ($juzg | Sort-Object conv)) {
  foreach ($f in @($c.juicio.fallas)) {
    $g = if ($f.grave) { "GRAVE" } else { "leve " }
    Write-Output ("  [" + $g + "] " + $c.conv + " t" + $f.turno + " " + $f.tipo + " — «" + $f.cita + "» " + $f.explicacion)
  }
}
$err = @($cs | Where-Object { $_.estado -eq "error" })
foreach ($e in $err) { Write-Output ("  [ERROR] " + $e.conv + ": " + $e.error) }
Write-Output ("examen_id: " + $ExamenId)
