// lib/screens/prediction/active_bet_card.dart
//
// Pari en cours : anneau de compte à rebours fluide, graphique en direct avec
// ligne de prix de référence et zones gagnante/perdante, écart en temps réel.

import 'dart:math' as math;
import 'dart:ui' show FontFeature;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/models/prediction_model.dart';
import 'package:wakati/providers/prediction_provider.dart';

import 'prediction_common.dart';

String _usdDelta(double d) {
  final sign = d > 0 ? '+' : (d < 0 ? '−' : '');
  return '$sign\$${fmtNumber(d.abs(), decimals: 2)}';
}

class ActiveBetCard extends StatelessWidget {
  final PredictionProvider provider;
  const ActiveBetCard({super.key, required this.provider});

  @override
  Widget build(BuildContext context) {
    final bet = provider.activeBet!;
    final cfg = provider.config;
    final cur = cfg?.currencySymbol ?? 'WAKATI';
    final total =
        bet.durationSeconds > 0 ? bet.durationSeconds : (cfg?.durationSeconds ?? 60);
    final int left = provider.secondsLeft.clamp(0, total).toInt();
    final price = provider.currentPrice;
    final ref = bet.priceAtBet;
    final isUp = bet.direction == 'UP';

    final diff = price > 0 ? price - ref : 0.0;
    final pct = ref > 0 ? diff / ref * 100 : 0.0;
    final bool? winning = diff == 0 ? null : (isUp ? diff > 0 : diff < 0);
    final stateColor =
        winning == null
            ? context.textSecondary
            : (winning ? AppColors.bullish : AppColors.bearish);

    final payout = bet.betAmount * bet.winMultiplier;
    final profit = payout - bet.betAmount;

    return PredCard(
      padding: const EdgeInsets.all(18),
      borderColor: stateColor.withValues(alpha: winning == null ? 0.3 : 0.5),
      borderWidth: 1.4,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── En-tête : direction + statut ──
          Row(
            children: [
              PredPill(
                text: directionLabel(bet.direction),
                color: directionColor(bet.direction),
                icon: directionIcon(bet.direction),
                filled: true,
              ),
              const SizedBox(width: 8),
              Text(
                'Pari en cours',
                style: TextStyle(
                  color: context.textSecondary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 250),
                child: _StatusPill(key: ValueKey(winning), winning: winning),
              ),
            ],
          ),
          const SizedBox(height: 18),

          // ── Anneau de compte à rebours ──
          Center(
            child: _TimerRing(
              left: left,
              total: total,
              color: directionColor(bet.direction),
            ),
          ),
          const SizedBox(height: 18),

          // ── Graphique en direct ──
          Container(
            height: 176,
            padding: const EdgeInsets.fromLTRB(4, 10, 4, 6),
            decoration: BoxDecoration(
              color: context.surfaceHighColor,
              borderRadius: BorderRadius.circular(16),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: _LiveChart(
                bet: bet,
                history: provider.priceHistory,
                currentPrice: price,
                total: total,
                elapsed: total - left,
                isUp: isUp,
                lineColor: stateColor,
              ),
            ),
          ),
          const SizedBox(height: 16),

          // ── Référence · Actuel · Écart ──
          Row(
            children: [
              Expanded(
                child: _Compare(
                  label: 'Référence',
                  value: fmtUsd(ref, decimals: ref == ref.roundToDouble() ? 0 : 2),
                  color: context.textPrimary,
                ),
              ),
              Expanded(
                child: _Compare(
                  label: 'Actuel',
                  value:
                      price > 0
                          ? fmtUsd(
                            price,
                            decimals: price == price.roundToDouble() ? 0 : 2,
                          )
                          : '—',
                  color: context.textPrimary,
                ),
              ),
              Expanded(
                child: _Compare(
                  label: 'Écart',
                  value: price > 0 ? _usdDelta(diff) : '—',
                  sub: price > 0 ? '${fmtSigned(pct, decimals: 3, trim: false)} %' : null,
                  color: stateColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Divider(height: 1, color: context.borderColor),
          const SizedBox(height: 14),

          // ── Mise et gain potentiel ──
          Row(
            children: [
              Expanded(
                child: _Compare(
                  label: 'Mise engagée',
                  value: '${fmtAmount(bet.betAmount)} $cur',
                  color: context.textPrimary,
                  align: CrossAxisAlignment.start,
                ),
              ),
              Expanded(
                child: _Compare(
                  label: 'Retour si gagné',
                  value: '${fmtAmount(payout)} $cur',
                  sub: '${fmtSigned(profit)} de profit',
                  color: AppColors.bullish,
                  align: CrossAxisAlignment.end,
                ),
              ),
            ],
          ),

          // ── Résolution en cours ──
          if (left == 0) ...[
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                minHeight: 4,
                backgroundColor: context.borderColor,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 8),
            Center(
              child: Text(
                'Résolution en cours…',
                style: TextStyle(
                  color: context.textSecondary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────

class _StatusPill extends StatelessWidget {
  final bool? winning;
  const _StatusPill({super.key, required this.winning});

  @override
  Widget build(BuildContext context) {
    if (winning == null) {
      return PredPill(
        text: 'Égalité',
        color: context.textSecondary,
        icon: Icons.drag_handle_rounded,
      );
    }
    return PredPill(
      text: winning! ? 'En gain' : 'En perte',
      color: winning! ? AppColors.bullish : AppColors.bearish,
      icon: winning! ? Icons.trending_up_rounded : Icons.trending_down_rounded,
    );
  }
}

class _Compare extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final Color color;
  final CrossAxisAlignment align;

  const _Compare({
    required this.label,
    required this.value,
    required this.color,
    this.sub,
    this.align = CrossAxisAlignment.center,
  });

  @override
  Widget build(BuildContext context) {
    final alignment =
        align == CrossAxisAlignment.start
            ? Alignment.centerLeft
            : (align == CrossAxisAlignment.end
                ? Alignment.centerRight
                : Alignment.center);
    return Column(
      crossAxisAlignment: align,
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
          alignment: alignment,
          child: Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 16,
              fontWeight: FontWeight.w800,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
        if (sub != null) ...[
          const SizedBox(height: 2),
          Text(
            sub!,
            style: TextStyle(
              color: color.withValues(alpha: 0.85),
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    );
  }
}

// ═════════════════════════════════════════════
//  ANNEAU DE COMPTE À REBOURS
// ═════════════════════════════════════════════

class _TimerRing extends StatelessWidget {
  final int left;
  final int total;
  final Color color;

  const _TimerRing({
    required this.left,
    required this.total,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final urgent = left <= 10 && left > 0;
    final ringColor = urgent ? AppColors.warning : color;
    final double progress =
        total <= 0 ? 0.0 : (left / total).clamp(0.0, 1.0).toDouble();

    return SizedBox(
      width: 164,
      height: 164,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Anneau animé en douceur entre chaque seconde
          TweenAnimationBuilder<double>(
            tween: Tween<double>(end: progress),
            duration: const Duration(milliseconds: 1000),
            curve: Curves.linear,
            builder:
                (_, value, __) => CustomPaint(
                  size: const Size(164, 164),
                  painter: _RingPainter(
                    progress: value,
                    color: ringColor,
                    track: context.borderColor,
                  ),
                ),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TweenAnimationBuilder<double>(
                key: ValueKey(urgent ? left : -1),
                tween: Tween<double>(begin: urgent ? 1.18 : 1.0, end: 1.0),
                duration: const Duration(milliseconds: 320),
                curve: Curves.easeOutBack,
                builder:
                    (_, scale, child) =>
                        Transform.scale(scale: scale, child: child),
                child: Text(
                  clockLabel(left),
                  style: TextStyle(
                    color: urgent ? AppColors.warning : context.textPrimary,
                    fontSize: 40,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'avant résolution',
                style: TextStyle(
                  color: context.textSecondary,
                  fontSize: 12,
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

class _RingPainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color track;

  _RingPainter({
    required this.progress,
    required this.color,
    required this.track,
  });

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 11.0;
    final center = size.center(Offset.zero);
    final radius = (size.width - stroke) / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);

    // Piste
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..color = track,
    );

    if (progress <= 0) return;
    final sweep = 2 * math.pi * progress;

    // Halo lumineux
    canvas.drawArc(
      rect,
      -math.pi / 2,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke + 4
        ..strokeCap = StrokeCap.round
        ..color = color.withValues(alpha: 0.28)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 7),
    );

    // Arc principal
    canvas.drawArc(
      rect,
      -math.pi / 2,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round
        ..color = color,
    );
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) =>
      old.progress != progress || old.color != color || old.track != track;
}

// ═════════════════════════════════════════════
//  GRAPHIQUE EN DIRECT
// ═════════════════════════════════════════════

class _LiveChart extends StatelessWidget {
  final PredictionBet bet;
  final List<PricePoint> history;
  final double currentPrice;
  final int total;
  final int elapsed;
  final bool isUp;
  final Color lineColor;

  const _LiveChart({
    required this.bet,
    required this.history,
    required this.currentPrice,
    required this.total,
    required this.elapsed,
    required this.isUp,
    required this.lineColor,
  });

  @override
  Widget build(BuildContext context) {
    final ref = bet.priceAtBet;

    // ── Points depuis le début du pari ──
    final spots = <FlSpot>[FlSpot(0, ref)];
    for (final pt in history) {
      final x = pt.time.difference(bet.betAt).inMilliseconds / 1000.0;
      if (x <= 0 || x > total) continue;
      spots.add(FlSpot(x, pt.price));
    }
    final double nowX = elapsed.toDouble().clamp(0.0, total.toDouble()).toDouble();
    if (currentPrice > 0 && spots.last.x < nowX - 0.5) {
      spots.add(FlSpot(nowX, currentPrice));
    }
    if (spots.length < 2) {
      spots.add(FlSpot(math.max(nowX, 1), currentPrice > 0 ? currentPrice : ref));
    }

    // ── Échelle verticale centrée sur la référence ──
    var maxDev = 0.0;
    for (final s in spots) {
      maxDev = math.max(maxDev, (s.y - ref).abs());
    }
    final pad = math.max(maxDev * 1.5, ref * 0.00025);
    final minY = ref - pad;
    final maxY = ref + pad;

    final winColor = AppColors.bullish;
    final loseColor = AppColors.bearish;
    final upZone = isUp ? winColor : loseColor;
    final downZone = isUp ? loseColor : winColor;

    return Stack(
      children: [
        Positioned.fill(
          child: LineChart(
          LineChartData(
            minX: 0,
            maxX: total.toDouble(),
            minY: minY,
            maxY: maxY,
            gridData: FlGridData(show: false),
            titlesData: FlTitlesData(show: false),
            borderData: FlBorderData(show: false),
            lineTouchData: LineTouchData(enabled: false),
            rangeAnnotations: RangeAnnotations(
              horizontalRangeAnnotations: [
                HorizontalRangeAnnotation(
                  y1: ref,
                  y2: maxY,
                  color: upZone.withValues(alpha: 0.08),
                ),
                HorizontalRangeAnnotation(
                  y1: minY,
                  y2: ref,
                  color: downZone.withValues(alpha: 0.08),
                ),
              ],
            ),
            extraLinesData: ExtraLinesData(
              horizontalLines: [
                HorizontalLine(
                  y: ref,
                  color: context.textSecondary.withValues(alpha: 0.75),
                  strokeWidth: 1.2,
                  dashArray: [6, 5],
                ),
              ],
            ),
            lineBarsData: [
              LineChartBarData(
                spots: spots,
                isCurved: true,
                curveSmoothness: 0.2,
                preventCurveOverShooting: true,
                color: lineColor,
                barWidth: 3,
                isStrokeCapRound: true,
                dotData: FlDotData(
                  show: true,
                  checkToShowDot: (spot, bar) => spot.x == bar.spots.last.x,
                ),
              ),
            ],
          ),
          duration: const Duration(milliseconds: 300),
          ),
        ),
        // Légendes des zones
        Positioned(
          top: 2,
          right: 8,
          child: _ZoneTag(
            text: isUp ? 'Zone gagnante' : 'Zone perdante',
            color: upZone,
          ),
        ),
        Positioned(
          bottom: 2,
          right: 8,
          child: _ZoneTag(
            text: isUp ? 'Zone perdante' : 'Zone gagnante',
            color: downZone,
          ),
        ),
        Positioned.fill(
          child: IgnorePointer(
            child: Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.only(left: 8, bottom: 16),
                child: Text(
                  'RÉFÉRENCE',
                  style: TextStyle(
                    color: context.textSecondary,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ZoneTag extends StatelessWidget {
  final String text;
  final Color color;
  const _ZoneTag({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        color: color.withValues(alpha: 0.85),
        fontSize: 9.5,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.8,
      ),
    );
  }
}
