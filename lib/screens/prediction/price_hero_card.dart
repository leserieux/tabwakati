// lib/screens/prediction/price_hero_card.dart
//
// Carte « prix en direct » : logo, prix qui clignote vert/rouge à chaque
// mouvement, variation 24 h, mini-graphique et état de fraîcheur.
// + bandeau de compte (solde, paris du jour, série).

import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show FontFeature;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/providers/prediction_provider.dart';

import 'prediction_common.dart';

class PriceHeroCard extends StatefulWidget {
  final String assetName;
  final String assetSymbol;
  final double price;
  final double change24h;
  final bool loading;
  final bool stale;
  final List<PricePoint> history;

  const PriceHeroCard({
    super.key,
    required this.assetName,
    required this.assetSymbol,
    required this.price,
    required this.change24h,
    required this.loading,
    required this.stale,
    required this.history,
  });

  @override
  State<PriceHeroCard> createState() => _PriceHeroCardState();
}

class _PriceHeroCardState extends State<PriceHeroCard> {
  double _prev = 0;
  Color? _flash;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _prev = widget.price;
  }

  @override
  void didUpdateWidget(covariant PriceHeroCard old) {
    super.didUpdateWidget(old);
    final np = widget.price;
    if (_prev > 0 && np > 0 && np != _prev) {
      _flash = np > _prev ? AppColors.bullish : AppColors.bearish;
      _timer?.cancel();
      _timer = Timer(const Duration(milliseconds: 900), () {
        if (mounted) setState(() => _flash = null);
      });
    }
    _prev = np;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hasPrice = widget.price > 0;

    return PredCard(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── En-tête : logo + nom + état live ──
          Row(
            children: [
              const _BtcLogo(),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.assetName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: context.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${widget.assetSymbol} / USDT',
                      style: TextStyle(
                        color: context.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              _LivePill(stale: widget.stale, hasPrice: hasPrice),
            ],
          ),
          const SizedBox(height: 16),

          // ── Prix + variation ──
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child:
                    hasPrice
                        ? FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: AnimatedDefaultTextStyle(
                            duration: const Duration(milliseconds: 300),
                            style: TextStyle(
                              color: _flash ?? context.textPrimary,
                              fontSize: 36,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -1,
                              fontFeatures: const [FontFeature.tabularFigures()],
                            ),
                            child: Text(fmtUsd(widget.price)),
                          ),
                        )
                        : Container(
                          height: 36,
                          width: 170,
                          decoration: BoxDecoration(
                            color: context.surfaceHighColor,
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
              ),
              if (hasPrice) ...[
                const SizedBox(width: 8),
                _ChangeBadge(change: widget.change24h),
              ],
            ],
          ),
          const SizedBox(height: 10),

          // ── Mini-graphique ──
          SizedBox(height: 72, child: _Sparkline(points: widget.history)),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────

class _BtcLogo extends StatelessWidget {
  const _BtcLogo();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 44,
      padding: const EdgeInsets.all(7),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: const Color(0xFFF7931A).withValues(alpha: 0.14),
      ),
      child: Image.asset(
        'assets/btc.png',
        fit: BoxFit.contain,
        errorBuilder:
            (_, __, ___) => const Center(
              child: Text(
                '₿',
                style: TextStyle(
                  color: Color(0xFFF7931A),
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
      ),
    );
  }
}

class _LivePill extends StatelessWidget {
  final bool stale;
  final bool hasPrice;
  const _LivePill({required this.stale, required this.hasPrice});

  @override
  Widget build(BuildContext context) {
    final color =
        !hasPrice
            ? context.textDisabled
            : (stale ? AppColors.warning : AppColors.bullish);
    final text = !hasPrice ? 'CONNEXION' : (stale ? 'DIFFÉRÉ' : 'LIVE');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          PulseDot(color: color, size: 7),
          const SizedBox(width: 7),
          Text(
            text,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.8,
            ),
          ),
        ],
      ),
    );
  }
}

class _ChangeBadge extends StatelessWidget {
  final double change;
  const _ChangeBadge({required this.change});

  @override
  Widget build(BuildContext context) {
    final up = change >= 0;
    final color = up ? AppColors.bullish : AppColors.bearish;
    return Container(
      padding: const EdgeInsets.fromLTRB(6, 5, 10, 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            up ? Icons.arrow_drop_up_rounded : Icons.arrow_drop_down_rounded,
            color: color,
            size: 22,
          ),
          Text(
            '${fmtNumber(change.abs(), decimals: 2)} %',
            style: TextStyle(
              color: color,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            '24 h',
            style: TextStyle(
              color: color.withValues(alpha: 0.7),
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────
//  SPARKLINE
// ─────────────────────────────────────────────

class _Sparkline extends StatelessWidget {
  final List<PricePoint> points;
  const _Sparkline({required this.points});

  @override
  Widget build(BuildContext context) {
    if (points.length < 2) {
      return Center(
        child: Text(
          'Le graphique se construit en direct…',
          style: TextStyle(color: context.textDisabled, fontSize: 12),
        ),
      );
    }

    final pts =
        points.length > 80 ? points.sublist(points.length - 80) : points;
    final prices = pts.map((e) => e.price).toList();
    var lo = prices.reduce(math.min);
    var hi = prices.reduce(math.max);
    final last = pts.last.price;

    // Évite un graphique « écrasé » quand le prix ne bouge presque pas
    if (hi - lo < last * 0.0004) {
      final mid = (hi + lo) / 2;
      final half = last * 0.0002;
      lo = mid - half;
      hi = mid + half;
    }
    final pad = (hi - lo) * 0.18;
    final color = last >= pts.first.price ? AppColors.bullish : AppColors.bearish;

    return LineChart(
      LineChartData(
        minX: 0,
        maxX: (pts.length - 1).toDouble(),
        minY: lo - pad,
        maxY: hi + pad,
        gridData: FlGridData(show: false),
        titlesData: FlTitlesData(show: false),
        borderData: FlBorderData(show: false),
        lineTouchData: LineTouchData(enabled: false),
        lineBarsData: [
          LineChartBarData(
            spots: [
              for (var i = 0; i < pts.length; i++)
                FlSpot(i.toDouble(), pts[i].price),
            ],
            isCurved: true,
            curveSmoothness: 0.22,
            preventCurveOverShooting: true,
            color: color,
            barWidth: 2.4,
            isStrokeCapRound: true,
            dotData: FlDotData(
              show: true,
              checkToShowDot: (spot, bar) => spot.x == bar.spots.last.x,
            ),
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  color.withValues(alpha: 0.28),
                  color.withValues(alpha: 0.0),
                ],
              ),
            ),
          ),
        ],
      ),
      duration: Duration.zero,
    );
  }
}

// ═════════════════════════════════════════════
//  BANDEAU DE COMPTE : solde · paris du jour · série
// ═════════════════════════════════════════════

class AccountStrip extends StatelessWidget {
  final double balance;
  final String currency;
  final int betsToday;
  final int maxBets;
  final int winStreak;

  const AccountStrip({
    super.key,
    required this.balance,
    required this.currency,
    required this.betsToday,
    required this.maxBets,
    required this.winStreak,
  });

  @override
  Widget build(BuildContext context) {
    final double ratio =
        maxBets <= 0 ? 0.0 : (betsToday / maxBets).clamp(0.0, 1.0).toDouble();
    final nearLimit = ratio >= 0.8;

    return PredCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: IntrinsicHeight(
        child: Row(
          children: [
            // Solde
            Expanded(
              flex: 5,
              child: _Cell(
                icon: Icons.account_balance_wallet_rounded,
                iconColor: AppColors.primary,
                label: 'Solde',
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: fmtAmount(balance),
                          style: TextStyle(
                            color: context.textPrimary,
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        TextSpan(
                          text: ' $currency',
                          style: TextStyle(
                            color: context.textSecondary,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            _divider(context),
            // Paris du jour
            Expanded(
              flex: 4,
              child: _Cell(
                icon: Icons.sports_esports_rounded,
                iconColor: nearLimit ? AppColors.warning : AppColors.info,
                label: 'Paris du jour',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$betsToday / $maxBets',
                      style: TextStyle(
                        color: context.textPrimary,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 5),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: ratio,
                        minHeight: 4,
                        backgroundColor: context.borderColor,
                        color: nearLimit ? AppColors.warning : AppColors.info,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            _divider(context),
            // Série
            Expanded(
              flex: 3,
              child: _Cell(
                icon: Icons.local_fire_department_rounded,
                iconColor:
                    winStreak >= 2 ? const Color(0xFFFF8A00) : context.textDisabled,
                label: 'Série',
                child: Text(
                  winStreak > 0 ? '$winStreak' : '—',
                  style: TextStyle(
                    color: context.textPrimary,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _divider(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 12),
    child: VerticalDivider(width: 1, thickness: 1, color: context.borderColor),
  );
}

class _Cell extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final Widget child;

  const _Cell({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Row(
          children: [
            Icon(icon, size: 14, color: iconColor),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: context.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}
