// lib/widgets/asset_icon.dart
// ============================================================================
// AssetIcon — logo de l'actif, toujours dans un cercle.
//
// Les logos sont des fichiers locaux (assets/coins/*.png, 128 px) : aucun
// appel réseau, affichage instantané et hors ligne. Les symboles inconnus
// retombent sur un avatar teinté avec l'initiale.
//
// Le symbole technique par réseau (ex: "USDC-POL") est réduit à sa base
// ("USDC"). FCFA et XAF partagent le même logo.
//
// Utilisation : AssetIcon(symbol: asset.assetSymbol, size: 40)
// ============================================================================

import 'package:flutter/material.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';

const Map<String, Color> _kAssetColors = {
  'BTC': Color(0xFFF7931A),
  'ETH': Color(0xFF627EEA),
  'BNB': Color(0xFFF3BA2F),
  'MATIC': Color(0xFF8247E5),
  'USDT': Color(0xFF26A17B),
  'USDC': Color(0xFF2775CA),
  'WAKATI': Color(0xFF7C4DFF),
  'FCFA': AppColors.bullish,
};

const Color _kDefaultAssetColor = Color(0xFF9A9AA6);

const String _kLogoDir = 'assets/coins/';

const Map<String, String> _kAssetLogoFile = {
  'BTC': 'btc.png',
  'ETH': 'eth.png',
  'BNB': 'bnb.png',
  'MATIC': 'matic.png',
  'USDT': 'usdt.png',
  'USDC': 'usdc.png',
  'TRX': 'trx.png',
  'WAKATI': 'wakati.png',
  'FCFA': 'fcfa.png',
  'XAF': 'fcfa.png',
};

/// Symbole de base pour la couleur/logo : "USDC-POL" → "USDC".
String assetBaseSymbol(String symbol) =>
    symbol.contains('-') ? symbol.split('-')[0] : symbol;

Color assetColor(String symbol) =>
    _kAssetColors[assetBaseSymbol(symbol).toUpperCase()] ?? _kDefaultAssetColor;

class AssetIcon extends StatelessWidget {
  final String symbol;
  final double size;

  const AssetIcon({super.key, required this.symbol, this.size = 40});

  @override
  Widget build(BuildContext context) {
    final base = assetBaseSymbol(symbol).toUpperCase();
    final color = assetColor(symbol);
    final logoFile = _kAssetLogoFile[base];

    // Repli : disque uni teinté de la couleur de l'actif, initiale pleine.
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withOpacity(0.16),
        shape: BoxShape.circle,
      ),
      child: Text(
        base.isNotEmpty ? base.substring(0, 1) : '?',
        style: TextStyle(
          color: color,
          fontSize: size * 0.42,
          fontWeight: FontWeight.w600,
        ),
      ),
    );

    if (logoFile == null) return fallback;

    return ClipOval(
      child: Image.asset(
        '$_kLogoDir$logoFile',
        width: size,
        height: size,
        fit: BoxFit.cover,
        filterQuality: FilterQuality.medium,
        errorBuilder: (_, __, ___) => fallback,
      ),
    );
  }
}
