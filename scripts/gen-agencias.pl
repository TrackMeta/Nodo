#!/usr/bin/perl
# Genera supabase/functions/_shared/shalom-agencias.ts desde los 6 JSON del
# directorio de Shalom que pasó Rodrigo. Se corre a mano cuando él consiga un
# volcado nuevo; no forma parte del build.
use strict;
use warnings;
use utf8;
use JSON::PP;

my $SRC  = "C:/Users/Rodrigo";
my $REPO = "D:/Bot Whatsapp Api";

# ── 1. Las 552 agencias ────────────────────────────────────────────────
my @todas;
for my $n (1 .. 6) {
    open(my $fh, "<:raw", "$SRC/shalom$n.json") or die "shalom$n: $!";
    local $/;
    push @todas, @{ decode_json(<$fh>)->{agencies} };
    close $fh;
}

# ── 2. Qué destinos acepta HOY el Excel de carga (para marcarlas) ──────
open(my $r, "<:raw", "$REPO/panel/courier/listas.json") or die "listas: $!";
my $raw = do { local $/; <$r> };
close $r;
my %excel = map { my $x = uc $_; $x =~ s/^\s+|\s+$//g; ($x => 1) }
            @{ decode_json($raw)->{shalom}{destino} };

sub esc {
    my $t = shift // "";
    $t =~ s/\\/\\\\/g;
    $t =~ s/"/\\"/g;
    return $t;
}

my (@filas, $conAereo);
for my $a (sort {
        ($a->{location}{department} // "") cmp ($b->{location}{department} // "")
     || ($a->{location}{province}   // "") cmp ($b->{location}{province}   // "")
     || ($a->{extra}{lugar_over}    // "") cmp ($b->{extra}{lugar_over}    // "")
    } @todas) {

    my @p    = split m{\s*/\s*}, ($a->{name} // "");
    my $l    = $a->{extra}{lugar_over} // $p[-1] // "";
    $l =~ s/^\s+|\s+$//g;
    next unless $l;

    my $dep  = $a->{location}{department} // "";
    my $prov = $a->{location}{province}   // "";
    my $dist = $p[2] // "";
    $dist =~ s/^\s+|\s+$//g;

    # Dirección: solo el primer tramo (lo de después repite distrito/provincia).
    my $dir = $a->{location}{address} // "";
    $dir =~ s/,.*$//s;
    $dir =~ s/\s+/ /g;
    $dir =~ s/^\s+|\s+$//g;
    $dir = substr($dir, 0, 58);
    $dir =~ s/\s+$//;

    my $aereo = ($a->{services} && $a->{services}{air}) ? ",a:1" : "";
    $conAereo++ if $aereo;

    my $dtxt = $dir ? ',dir:"' . esc($dir) . '"' : "";
    push @filas, sprintf('  {l:"%s",d:"%s",p:"%s",t:"%s"%s%s},',
        esc($l), esc($dep), esc($prov), esc($dist), $dtxt, $aereo);
}

open(my $o, ">:encoding(UTF-8)", "/tmp/agencias-datos.txt") or die $!;
print $o join("\n", @filas), "\n";
close $o;

printf("filas: %d · con aéreo: %d\n", scalar @filas, $conAereo);
