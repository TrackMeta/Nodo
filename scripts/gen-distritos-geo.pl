#!/usr/bin/perl
# Genera supabase/functions/_shared/distritos-geo.ts desde ubigeo_distrito.csv de
# jmcastagnetto/ubigeo-peru-aumentado (MIT). Se corre a mano; no es parte del build.
#   curl -sSLo ubigeo_distrito.csv https://raw.githubusercontent.com/jmcastagnetto/ubigeo-peru-aumentado/main/ubigeo_distrito.csv
# Deja las filas en geo-datos.txt para pegarlas dentro del objeto PUNTOS.
use strict; use warnings; use utf8; use Unicode::Normalize;
binmode(STDOUT, ":encoding(UTF-8)");
sub nz { my $t = uc(shift // ""); $t = NFD($t); $t =~ s/\pM//g; $t =~ s/[^A-Z0-9]+/ /g; $t =~ s/^ | $//g; return $t; }
open(my $c, "<:encoding(UTF-8)", "ubigeo_distrito.csv") or die $!;
my $h = <$c>;
my (%pt, $n, $sinCoord);
while (my $l = <$c>) {
  chomp $l; my @x = split /,/, $l;
  next unless @x > 16;
  my ($dep, $prov, $dist, $lat, $lon) = ($x[2], $x[3], $x[4], $x[14], $x[15]);
  unless (defined $lat && defined $lon && $lat =~ /^-?[\d.]+$/ && $lon =~ /^-?[\d.]+$/) { $sinCoord++; next; }
  $pt{ nz($dist) . "|" . nz($prov) } = sprintf("%.4f,%.4f", $lat, $lon);
  $n++;
}
close $c;
open(my $o, ">:encoding(UTF-8)", "geo-datos.txt") or die $!;
for my $k (sort keys %pt) { print $o qq(  "$k": "$pt{$k}",\n); }
close $o;
printf("distritos con coordenada: %d · sin: %d · claves: %d\n", $n, $sinCoord // 0, scalar keys %pt);
