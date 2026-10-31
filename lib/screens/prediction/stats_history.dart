// lib/screens/prediction/stats_history.dart
//
// « Mes performances » (anneau de réussite, tuiles, forme récente)
// et « Historique » (lignes détaillées : direction, prix, date, résultat).

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/models/prediction_model.dart';

import 'prediction_common.dart';

Color _outcomeColor(BuildContext context, PredictionBet b) {
  if (b.isWon) return AppColors.bullish;
  if (b.isLost) return AppColors.bearish;
  return context.textSecondary;
}

// ═════════════════════════════════════════════
//  STATISTIQUES
// ═════════════════════════════════════════════

class StatsCard extends StatelessWidget {
  final PredictionStats stats;
  final List<PredictionBet> history;
  final String currency;

  const StatsCard({
    super.key,
    required this.stats,
    required this.history,
    required this.currency,
  });

  @override
  Widget build(BuildContext context) {
    final net = stats.netProfit;
    final netColor =
        net > 0
            ? AppColors.bullish
            : (net < 0 ? AppColors.bearish : context.textPrimary);
    final recent = history.take(10).toList().reversed.toList();

    return PredCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Mes performances',
            style: TextStyle(
              color: context.textPrimary,
              fontSize: 17,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.2,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              _WinRing(rate: stats.winRate),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _Tile(
                            icon: Icons.sports_esports_rounded,
                            label: 'Paris joués',
                            value: '${stats.totalBets}',
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _Tile(
                            icon: Icons.local_fire_department_rounded,
                            iconColor: const Color(0xFFFF8A00),
                            label: 'Meilleure série',
                            value: '${stats.bestWinStreak}',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: _Tile(
                            icon: Icons.bolt_rounded,
                            iconColor: AppColors.warning,
                            label: 'Série actuelle',
                            value: '${stats.winStreak}',
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _Tile(
                            icon: Icons.savings_rounded,
                            iconColor: netColor,
                            label: 'Profit net',
                            value: fmtSigned(net),
                            valueColor: netColor,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (recent.isNotEmpty) ...[
            const SizedBox(height: 16),
            Divider(height: 1, color: context.borderColor),
            const SizedBox(height: 14),
            Row(
              children: [
                Text(
                  'Forme récente',
                  style: TextStyle(
                    color: context.textSecondary,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                for (var i = 0; i < recent.length; i++)
                  Padding(
                    padding: EdgeInsets.only(left: i == 0 ? 0 : 5),
                    child: Container(
                      width: 14,
                      height: 14,
                      decoration: BoxDecoration(
                        color: _outcomeColor(context, recent[i]),
                        shape: BoxShape.circle,
                        boxShadow:
                            i == recent.length - 1
                                ? AppShadows.glow(_outcomeColor(context, recent[i]))
                                : null,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  final IconData icon;
  final Color? iconColor;
  final String label;
  final String value;
  final Color? valueColor;

  const _Tile({
    required this.icon,
    required this.label,
    required this.value,
    this.iconColor,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
      decoration: BoxDecoration(
        color: context.surfaceHighColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: iconColor ?? AppColors.primary),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: context.textSecondary,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: TextStyle(
                color: valueColor ?? context.textPrimary,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WinRing extends StatelessWidget {
  final double rate; // 0..100
  const _WinRing({required this.rate});

  @override
  Widget build(BuildContext context) {
    final double target = (rate / 100).clamp(0.0, 1.0).toDouble();
    return SizedBox(
      width: 96,
      height: 96,
      child: Stack(
        alignment: Alignment.center,
        children: [
          TweenAnimationBuilder<double>(
            tween: Tween<double>(begin: 0.0, end: target),
            duration: const Duration(milliseconds: 900),
            curve: Curves.easeOutCubic,
            builder:
                (_, v, __) => CustomPaint(
                  size: const Size(96, 96),
                  painter: _WinRingPainter(
                    progress: v,
                    color: AppColors.bullish,
                    track: context.borderColor,
                  ),
                ),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '${rate.round()}%',
                style: TextStyle(
                  color: context.textPrimary,
                  fontSize: 21,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                'réussite',
                style: TextStyle(
                  color: context.textSecondary,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _WinRingPainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color track;
  _WinRingPainter({
    required this.progress,
    required this.color,
    required this.track,
  });

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 9.0;
    final center = size.center(Offset.zero);
    final radius = (size.width - stroke) / 2;
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..color = track,
    );
    if (progress <= 0) return;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      2 * math.pi * progress,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round
        ..color = color,
    );
  }

  @override
  bool shouldRepaint(covariant _WinRingPainter old) =>
      old.progress != progress || old.color != color || old.track != track;
}

// ═════════════════════════════════════════════
//  HISTORIQUE
// ═════════════════════════════════════════════

class HistoryCard extends StatefulWidget {
  final List<PredictionBet> history;
  final String currency;
  const HistoryCard({super.key, required this.history, required this.currency});

  @override
  State<HistoryCard> createState() => _HistoryCardState();
}

class _HistoryCardState extends State<HistoryCard> {
  static const int _collapsed = 4;
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final all = widget.history;
    final visible = _expanded ? all : all.take(_collapsed).toList();

    return PredCard(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Historique',
                style: TextStyle(
                  color: context.textPrimary,
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.2,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: context.surfaceHighColor,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${all.length}',
                  style: TextStyle(
                    color: context.textSecondary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          AnimatedSize(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: Column(
              children: [
                for (var i = 0; i < visible.length; i++) ...[
                  _HistoryRow(bet: visible[i], currency: widget.currency),
                  if (i != visible.length - 1)
                    Divider(height: 1, color: context.borderColor),
                ],
              ],
            ),
          ),
          if (all.length > _collapsed)
            Center(
              child: TextButton.icon(
                onPressed: () => setState(() => _expanded = !_expanded),
                icon: Icon(
                  _expanded
                      ? Icons.keyboard_arrow_up_rounded
                      : Icons.keyboard_arrow_down_rounded,
                  size: 20,
                ),
                label: Text(
                  _expanded ? 'Réduire' : 'Voir tout (${all.length})',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                style: TextButton.styleFrom(foregroundColor: AppColors.primary),
              ),
            )
          else
            const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  final PredictionBet bet;
  final String currency;
  const _HistoryRow({required this.bet, required this.currency});

  @override
  Widget build(BuildContext context) {
    final c = _outcomeColor(context, bet);
    final profit = bet.profitAmount ?? (bet.isLost ? -bet.betAmount : 0.0);
    final amountText = bet.isCancelled ? '0' : fmtSigned(profit);
    final status = bet.isWon ? 'Gagné' : (bet.isLost ? 'Perdu' : 'Remboursé');
    final resolution = bet.priceAtResolution;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: c.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(directionIcon(bet.direction), color: c, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${directionLabel(bet.direction)} · ${fmtAmount(bet.betAmount)} $currency',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: context.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '${fmtUsd(bet.priceAtBet)}  →  '
                  '${resolution != null ? fmtUsd(resolution) : '—'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: context.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  dateLabel(bet.betAt),
                  style: TextStyle(color: context.textDisabled, fontSize: 11.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                amountText,
                style: TextStyle(
                  color: c,
                  fontSize: 15.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 3),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: c.withValues(alpha: 0.13),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  status,
                  style: TextStyle(
                    color: c,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
