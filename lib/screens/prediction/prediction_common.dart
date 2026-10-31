// lib/screens/prediction/prediction_common.dart
//
// Briques partagées par tous les widgets de l'écran « Prédiction » :
// formats de nombres, carte, pastilles, animations d'entrée, squelette.

import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';

const double kPredRadius = 18;

// ─────────────────────────────────────────────
//  FORMATS
// ─────────────────────────────────────────────

/// 1250.5 → "1 250,5" (espace insécable pour les milliers, virgule décimale)
String fmtNumber(double v, {int decimals = 2, bool trimZeros = false}) {
  final neg = v < 0;
  var s = v.abs().toStringAsFixed(decimals);
  if (trimZeros && s.contains('.')) {
    s = s.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
  }
  final parts = s.split('.');
  final intPart = parts[0].replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => '\u00A0',
  );
  final dec = parts.length > 1 ? ',${parts[1]}' : '';
  return '${neg ? '-' : ''}$intPart$dec';
}

/// Montant de jeu (WAKATI) : sans décimales inutiles.
String fmtAmount(double v) => fmtNumber(v, decimals: 2, trimZeros: true);

/// Montant avec signe explicite : +50 / −100
String fmtSigned(double v, {int decimals = 2, bool trim = true}) {
  final sign = v > 0 ? '+' : (v < 0 ? '−' : '');
  return '$sign${fmtNumber(v.abs(), decimals: decimals, trimZeros: trim)}';
}

/// Prix en dollars : $77 774
String fmtUsd(double v, {int? decimals}) {
  if (v <= 0) return '—';
  final d = decimals ?? (v >= 1000 && v == v.roundToDouble() ? 0 : 2);
  return '\$${fmtNumber(v, decimals: d)}';
}

/// 60 → "1 min", 90 → "1 min 30 s", 45 → "45 sec"
String durationLabel(int seconds) {
  if (seconds >= 60 && seconds % 60 == 0) return '${seconds ~/ 60} min';
  if (seconds >= 60) return '${seconds ~/ 60} min ${seconds % 60} s';
  return '$seconds sec';
}

/// 75 → "01:15"
String clockLabel(int seconds) {
  final s = seconds < 0 ? 0 : seconds;
  final m = (s ~/ 60).toString().padLeft(2, '0');
  final r = (s % 60).toString().padLeft(2, '0');
  return '$m:$r';
}

String directionLabel(String d) => d == 'UP' ? 'Hausse' : 'Baisse';
IconData directionIcon(String d) =>
    d == 'UP' ? Icons.trending_up_rounded : Icons.trending_down_rounded;
Color directionColor(String d) =>
    d == 'UP' ? AppColors.bullish : AppColors.bearish;
LinearGradient directionGradient(String d) =>
    d == 'UP' ? AppColors.bullishGradient : AppColors.bearishGradient;

/// « Aujourd'hui · 14:32 », « Hier · 09:10 », « 28/10 · 18:02 »
String dateLabel(DateTime utc) {
  final d = utc.toLocal();
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(d.year, d.month, d.day);
  final diff = today.difference(day).inDays;
  final hm =
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  if (diff == 0) return "Aujourd'hui · $hm";
  if (diff == 1) return 'Hier · $hm';
  final dm =
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  return '$dm · $hm';
}

// ─────────────────────────────────────────────
//  CARTE
// ─────────────────────────────────────────────

class PredCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? borderColor;
  final Gradient? gradient;
  final double borderWidth;

  const PredCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.borderColor,
    this.gradient,
    this.borderWidth = 1,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: gradient == null ? context.surfaceColor : null,
        gradient: gradient,
        borderRadius: BorderRadius.circular(kPredRadius),
        border: Border.all(
          color: borderColor ?? context.borderColor,
          width: borderWidth,
        ),
        boxShadow: context.isDark ? null : AppShadows.cardLight,
      ),
      child: child,
    );
  }
}

// ─────────────────────────────────────────────
//  PASTILLE
// ─────────────────────────────────────────────

class PredPill extends StatelessWidget {
  final String text;
  final Color color;
  final IconData? icon;
  final bool filled;

  const PredPill({
    super.key,
    required this.text,
    required this.color,
    this.icon,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    final fg = filled ? Colors.white : color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: filled ? color : color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: 4),
          ],
          Text(
            text,
            style: TextStyle(
              color: fg,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────
//  POINT QUI PULSE (indicateur « live »)
// ─────────────────────────────────────────────

class PulseDot extends StatefulWidget {
  final Color color;
  final double size;
  const PulseDot({super.key, required this.color, this.size = 8});

  @override
  State<PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<PulseDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder:
          (_, __) => Container(
            width: widget.size,
            height: widget.size,
            decoration: BoxDecoration(
              color: widget.color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: widget.color.withValues(alpha: 0.55 * _c.value),
                  blurRadius: 6,
                  spreadRadius: 2 * _c.value,
                ),
              ],
            ),
          ),
    );
  }
}

// ─────────────────────────────────────────────
//  EFFET D'APPUI (léger « rebond » au toucher)
// ─────────────────────────────────────────────

class PressableScale extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  const PressableScale({super.key, required this.child, this.onTap});

  @override
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v && mounted) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: enabled ? (_) => _set(true) : null,
      onTapUp: enabled ? (_) => _set(false) : null,
      onTapCancel: enabled ? () => _set(false) : null,
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _down ? 0.96 : 1.0,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
        child: widget.child,
      ),
    );
  }
}

// ─────────────────────────────────────────────
//  ENTRÉE EN FONDU + GLISSEMENT (échelonnée)
// ─────────────────────────────────────────────

class FadeSlideIn extends StatefulWidget {
  final Widget child;
  final int delayMs;
  const FadeSlideIn({super.key, required this.child, this.delayMs = 0});

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 420),
  );
  late final Animation<double> _a = CurvedAnimation(
    parent: _c,
    curve: Curves.easeOutCubic,
  );

  @override
  void initState() {
    super.initState();
    if (widget.delayMs <= 0) {
      _c.forward();
    } else {
      Future.delayed(Duration(milliseconds: widget.delayMs), () {
        if (mounted) _c.forward();
      });
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _a,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.04),
          end: Offset.zero,
        ).animate(_a),
        child: widget.child,
      ),
    );
  }
}

// ─────────────────────────────────────────────
//  FOND DE FEUILLE MODALE (poignée + arrondis)
// ─────────────────────────────────────────────

class SheetFrame extends StatelessWidget {
  final Widget child;
  const SheetFrame({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: context.surfaceColor,
        borderRadius: AppSpacing.sheet,
        border: Border(top: BorderSide(color: context.borderColor)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: context.borderColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              Flexible(child: child),
            ],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────
//  SQUELETTE DE CHARGEMENT
// ─────────────────────────────────────────────

class PredictionSkeleton extends StatelessWidget {
  const PredictionSkeleton({super.key});

  Widget _box(double h) => Container(
    height: h,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(kPredRadius),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final base = context.isDark ? const Color(0xFF2B3139) : const Color(0xFFE6E8EA);
    final hi = context.isDark ? const Color(0xFF3A414B) : const Color(0xFFF5F7FA);
    return SingleChildScrollView(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      child: Shimmer.fromColors(
        baseColor: base,
        highlightColor: hi,
        child: Column(
          children: [
            _box(196),
            const SizedBox(height: 12),
            _box(66),
            const SizedBox(height: 12),
            _box(340),
            const SizedBox(height: 12),
            _box(150),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────
//  BOUTON DÉGRADÉ
// ─────────────────────────────────────────────

class PredGradientButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final Gradient gradient;
  final Color glow;
  final VoidCallback? onTap;
  final double height;

  const PredGradientButton({
    super.key,
    required this.label,
    required this.gradient,
    required this.glow,
    this.icon,
    this.onTap,
    this.height = 52,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: Container(
        decoration: BoxDecoration(
          gradient: gradient,
          borderRadius: BorderRadius.circular(14),
          boxShadow: enabled ? AppShadows.glow(glow) : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: onTap,
            child: SizedBox(
              height: height,
              child: Center(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, color: Colors.white, size: 20),
                      const SizedBox(width: 8),
                    ],
                    Text(
                      label,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
