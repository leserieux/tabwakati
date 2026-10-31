// lib/screens/prediction/result_sheet.dart
//
// Feuille de résultat : icône qui « pop », montant qui défile, confettis en
// cas de victoire, comparaison des prix et bouton « Rejouer ».
// Se ferme avec 'replay' (rejouer la même direction) ou null.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/models/prediction_model.dart';

import 'prediction_common.dart';

class ResultSheet extends StatelessWidget {
  final BetResult result;
  final String currency;

  const ResultSheet({super.key, required this.result, required this.currency});

  @override
  Widget build(BuildContext context) {
    final won = result.isWon;
    final refunded = result.isRefunded;
    final color =
        won ? AppColors.bullish : (refunded ? AppColors.warning : AppColors.bearish);
    final gradient =
        won
            ? AppColors.bullishGradient
            : (refunded
                ? const LinearGradient(
                  colors: [Color(0xFFF59E0B), Color(0xFFD97706)],
                )
                : AppColors.bearishGradient);

    final title =
        won ? 'Bien joué !' : (refunded ? 'Pari remboursé' : 'Pas cette fois');
    final subtitle =
        won
            ? 'Votre prédiction était la bonne.'
            : (refunded
                ? 'Le prix n\'a pas bougé : votre mise vous est rendue.'
                : 'Le marché a pris une autre direction.');
    final icon =
        won
            ? Icons.emoji_events_rounded
            : (refunded ? Icons.replay_rounded : Icons.close_rounded);

    final dir = result.direction;
    final moved = result.priceAtResolution - result.priceAtBet;
    final movedPct =
        result.priceAtBet > 0 ? moved / result.priceAtBet * 100 : 0.0;
    final moveColor =
        moved == 0
            ? context.textSecondary
            : (moved > 0 ? AppColors.bullish : AppColors.bearish);

    return SheetFrame(
      child: Stack(
        children: [
          if (won) const Positioned.fill(child: _Confetti()),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // ── Icône ──
              TweenAnimationBuilder<double>(
                tween: Tween<double>(begin: 0.0, end: 1.0),
                duration: const Duration(milliseconds: 700),
                curve: Curves.easeOutBack,
                builder:
                    (_, v, child) => Transform.scale(scale: v, child: child),
                child: Container(
                  width: 88,
                  height: 88,
                  decoration: BoxDecoration(
                    gradient: gradient,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: color.withValues(alpha: 0.4),
                        blurRadius: 28,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: Icon(icon, color: Colors.white, size: 44),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                title,
                style: TextStyle(
                  color: context.textPrimary,
                  fontSize: 25,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: context.textSecondary,
                  fontSize: 13.5,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 16),

              // ── Montant qui défile ──
              if (refunded)
                Text(
                  '${fmtAmount(result.betAmount)} $currency',
                  style: TextStyle(
                    color: color,
                    fontSize: 34,
                    fontWeight: FontWeight.w800,
                  ),
                )
              else
                TweenAnimationBuilder<double>(
                  tween: Tween<double>(begin: 0.0, end: result.profitAmount),
                  duration: const Duration(milliseconds: 1000),
                  curve: Curves.easeOutCubic,
                  builder:
                      (_, v, __) => Text(
                        '${fmtSigned(v)} $currency',
                        style: TextStyle(
                          color: color,
                          fontSize: 36,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                        ),
                      ),
                ),
              if (won) ...[
                const SizedBox(height: 4),
                Text(
                  'Retour total : ${fmtAmount(result.payoutAmount)} $currency',
                  style: TextStyle(
                    color: context.textSecondary,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              const SizedBox(height: 18),

              // ── Comparaison des prix ──
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: context.surfaceHighColor,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _PriceCol(
                            label: 'Référence',
                            value: fmtUsd(result.priceAtBet),
                          ),
                        ),
                        Icon(
                          Icons.arrow_forward_rounded,
                          color: context.textDisabled,
                          size: 20,
                        ),
                        Expanded(
                          child: _PriceCol(
                            label: 'À l\'échéance',
                            value: fmtUsd(result.priceAtResolution),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Divider(height: 1, color: context.borderColor),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        if (dir != null)
                          PredPill(
                            text: 'Votre pari : ${directionLabel(dir)}',
                            color: directionColor(dir),
                            icon: directionIcon(dir),
                          )
                        else
                          const SizedBox.shrink(),
                        Text(
                          '${_signedUsd(moved)}  (${fmtSigned(movedPct, decimals: 3, trim: false)} %)',
                          style: TextStyle(
                            color: moveColor,
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // ── Actions ──
              if (dir != null)
                Row(
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 52,
                        child: OutlinedButton(
                          onPressed: () => Navigator.pop(context),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: context.textPrimary,
                            side: BorderSide(color: context.borderColor),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                          child: const Text(
                            'Fermer',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: PredGradientButton(
                        label: 'Rejouer · ${directionLabel(dir)}',
                        icon: Icons.refresh_rounded,
                        gradient: directionGradient(dir),
                        glow: directionColor(dir),
                        onTap: () => Navigator.pop(context, 'replay'),
                      ),
                    ),
                  ],
                )
              else
                SizedBox(
                  width: double.infinity,
                  child: PredGradientButton(
                    label: 'Fermer',
                    gradient: AppColors.primaryGradient,
                    glow: AppColors.primary,
                    onTap: () => Navigator.pop(context),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  static String _signedUsd(double d) {
    final sign = d > 0 ? '+' : (d < 0 ? '−' : '');
    return '$sign\$${fmtNumber(d.abs(), decimals: 2)}';
  }
}

class _PriceCol extends StatelessWidget {
  final String label;
  final String value;
  const _PriceCol({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          label,
          style: TextStyle(
            color: context.textSecondary,
            fontSize: 11.5,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            value,
            style: TextStyle(
              color: context.textPrimary,
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

// ═════════════════════════════════════════════
//  CONFETTIS
// ═════════════════════════════════════════════

class _Particle {
  final double vx;
  final double vy;
  final double size;
  final double rot;
  final double rotSpeed;
  final Color color;

  const _Particle({
    required this.vx,
    required this.vy,
    required this.size,
    required this.rot,
    required this.rotSpeed,
    required this.color,
  });
}

class _Confetti extends StatefulWidget {
  const _Confetti();

  @override
  State<_Confetti> createState() => _ConfettiState();
}

class _ConfettiState extends State<_Confetti>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  )..forward();

  late final List<_Particle> _ps = _make();

  List<_Particle> _make() {
    final r = math.Random();
    final colors = <Color>[
      AppColors.bullish,
      AppColors.primary,
      AppColors.secondary,
      AppColors.warning,
      Colors.white,
    ];
    return List.generate(
      52,
      (_) => _Particle(
        vx: (r.nextDouble() * 2 - 1) * 1.1,
        vy: -(0.3 + r.nextDouble() * 0.7),
        size: 6 + r.nextDouble() * 6,
        rot: r.nextDouble() * math.pi,
        rotSpeed: (r.nextDouble() * 2 - 1) * 10,
        color: colors[r.nextInt(colors.length)],
      ),
    );
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _c,
        builder:
            (_, __) => CustomPaint(
              size: Size.infinite,
              painter: _ConfettiPainter(_ps, _c.value),
            ),
      ),
    );
  }
}

class _ConfettiPainter extends CustomPainter {
  final List<_Particle> particles;
  final double t;
  _ConfettiPainter(this.particles, this.t);

  @override
  void paint(Canvas canvas, Size size) {
    final alpha = t < 0.7 ? 1.0 : (1 - (t - 0.7) / 0.3).clamp(0.0, 1.0).toDouble();
    for (final p in particles) {
      final x = size.width / 2 + p.vx * size.width * 0.55 * t;
      final y =
          size.height * 0.22 +
          p.vy * size.height * t +
          0.5 * size.height * 2.2 * t * t;
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(p.rot + p.rotSpeed * t);
      canvas.drawRect(
        Rect.fromCenter(center: Offset.zero, width: p.size, height: p.size * 0.55),
        Paint()..color = p.color.withValues(alpha: alpha),
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ConfettiPainter old) => old.t != t;
}
