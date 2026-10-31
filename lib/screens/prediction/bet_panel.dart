// lib/screens/prediction/bet_panel.dart
//
// Panneau « Votre prédiction » : cartes Hausse / Baisse, résumé gain/perte
// clair, états (solde insuffisant, limite…), feuille de confirmation,
// feuille « Comment ça marche ? » et carte d'accueil pour les nouveaux joueurs.

import 'package:flutter/material.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/models/prediction_model.dart';
import 'package:wakati/providers/prediction_provider.dart';

import 'prediction_common.dart';

// ═════════════════════════════════════════════
//  PANNEAU DE PARI
// ═════════════════════════════════════════════

class BetPanel extends StatefulWidget {
  final PredictionProvider provider;
  final bool confirmBets;
  final ValueChanged<bool> onConfirmChanged;
  final Future<void> Function(String direction, double amount) onBet;
  final VoidCallback onRecharge;

  const BetPanel({
    super.key,
    required this.provider,
    required this.confirmBets,
    required this.onConfirmChanged,
    required this.onBet,
    required this.onRecharge,
  });

  @override
  State<BetPanel> createState() => _BetPanelState();
}

class _BetPanelState extends State<BetPanel> {
  double? _amount; // utilisé seulement en mode « mise variable »
  String? _tapped;

  Future<void> _tap(String direction, double amount) async {
    setState(() => _tapped = direction);
    try {
      await widget.onBet(direction, amount);
    } finally {
      if (mounted) setState(() => _tapped = null);
    }
  }

  List<double> _presets(PredictionConfig cfg) {
    final range = cfg.betMax - cfg.betMin;
    final raw = <double>[
      cfg.betMin,
      cfg.betMin + range * 0.25,
      cfg.betMin + range * 0.5,
      cfg.betMax,
    ];
    final out = <double>[];
    for (final v in raw) {
      final r = v.roundToDouble();
      if (!out.contains(r)) out.add(r);
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.provider;
    final cfg = p.config!;
    final isFixed = cfg.betMode == 'fixed';
    final amount =
        isFixed
            ? cfg.betAmount
            : (_amount ?? cfg.betMin).clamp(cfg.betMin, cfg.betMax).toDouble();
    final payout = amount * cfg.winMultiplier;
    final profit = payout - amount;
    final cur = cfg.currencySymbol;

    // ── États bloquants ──
    final inactive = !cfg.isActive;
    final limitReached = p.betsToday >= cfg.maxBetsPerDay;
    final insufficient = p.balance < amount;
    final priceReady = p.isPriceReady;
    final busy = p.isActing || _tapped != null;
    final enabled =
        !inactive && !limitReached && !insufficient && priceReady && !busy;

    Widget? notice;
    if (inactive) {
      notice = _Notice(
        icon: Icons.pause_circle_outline_rounded,
        color: AppColors.warning,
        text: 'Le jeu est temporairement indisponible.',
      );
    } else if (limitReached) {
      notice = _Notice(
        icon: Icons.event_busy_rounded,
        color: AppColors.warning,
        text:
            'Limite de ${cfg.maxBetsPerDay} paris atteinte aujourd\'hui. Revenez demain !',
      );
    } else if (insufficient) {
      notice = _Notice(
        icon: Icons.account_balance_wallet_outlined,
        color: AppColors.bearish,
        text: 'Solde insuffisant pour miser ${fmtAmount(amount)} $cur.',
        actionLabel: 'Recharger',
        onAction: widget.onRecharge,
      );
    } else if (!priceReady) {
      notice = _Notice(
        icon: Icons.sync_rounded,
        color: AppColors.info,
        text: 'En attente du prix du Bitcoin…',
      );
    }

    return PredCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Titre ──
          Row(
            children: [
              Expanded(
                child: Text(
                  'Votre prédiction',
                  style: TextStyle(
                    color: context.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.2,
                  ),
                ),
              ),
              InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: () => showRulesSheet(context, cfg),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.help_outline_rounded,
                        size: 18,
                        color: context.textSecondary,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Règles',
                        style: TextStyle(
                          color: context.textSecondary,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Dans ${durationLabel(cfg.durationSeconds)}, le prix du '
            '${cfg.assetName} sera-t-il plus haut ou plus bas qu\'à présent ?',
            style: TextStyle(
              color: context.textSecondary,
              fontSize: 13.5,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),

          // ── Mise variable : préréglages ──
          if (!isFixed) ...[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final v in _presets(cfg))
                  _AmountChip(
                    label: fmtAmount(v),
                    selected: v == amount,
                    onTap: () => setState(() => _amount = v),
                  ),
              ],
            ),
            const SizedBox(height: 14),
          ],

          // ── Résumé mise / gain / perte ──
          _StakeSummary(
            stake: '${fmtAmount(amount)} $cur',
            win: fmtSigned(profit),
            loss: fmtSigned(-amount),
          ),
          const SizedBox(height: 14),

          // ── Hausse / Baisse ──
          Row(
            children: [
              Expanded(
                child: _DirectionCard(
                  direction: 'UP',
                  profit: profit,
                  enabled: enabled,
                  busy: _tapped == 'UP',
                  onTap: () => _tap('UP', amount),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _DirectionCard(
                  direction: 'DOWN',
                  profit: profit,
                  enabled: enabled,
                  busy: _tapped == 'DOWN',
                  onTap: () => _tap('DOWN', amount),
                ),
              ),
            ],
          ),

          if (notice != null) ...[const SizedBox(height: 14), notice],

          const SizedBox(height: 14),
          Divider(height: 1, color: context.borderColor),
          const SizedBox(height: 6),

          // ── Confirmation ──
          Row(
            children: [
              Icon(
                Icons.verified_user_outlined,
                size: 16,
                color: context.textSecondary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Confirmer avant chaque pari',
                  style: TextStyle(
                    color: context.textSecondary,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Transform.scale(
                scale: 0.82,
                child: Switch(
                  value: widget.confirmBets,
                  onChanged: widget.onConfirmChanged,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────

class _AmountChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _AmountChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        decoration: BoxDecoration(
          gradient: selected ? AppColors.primaryGradient : null,
          color: selected ? null : context.surfaceHighColor,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? Colors.transparent : context.borderColor,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : context.textPrimary,
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _StakeSummary extends StatelessWidget {
  final String stake;
  final String win;
  final String loss;
  const _StakeSummary({
    required this.stake,
    required this.win,
    required this.loss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: context.surfaceHighColor,
        borderRadius: BorderRadius.circular(14),
      ),
      child: IntrinsicHeight(
        child: Row(
          children: [
            Expanded(
              flex: 5,
              child: _Metric(
                label: 'Mise',
                value: stake,
                color: context.textPrimary,
              ),
            ),
            VerticalDivider(width: 20, thickness: 1, color: context.borderColor),
            Expanded(
              flex: 3,
              child: _Metric(
                label: 'Si gagné',
                value: win,
                color: AppColors.bullish,
              ),
            ),
            VerticalDivider(width: 20, thickness: 1, color: context.borderColor),
            Expanded(
              flex: 3,
              child: _Metric(
                label: 'Si perdu',
                value: loss,
                color: AppColors.bearish,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _Metric({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
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
          alignment: Alignment.centerLeft,
          child: Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 15.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

class _DirectionCard extends StatelessWidget {
  final String direction;
  final double profit;
  final bool enabled;
  final bool busy;
  final VoidCallback onTap;

  const _DirectionCard({
    required this.direction,
    required this.profit,
    required this.enabled,
    required this.busy,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = directionColor(direction);
    return PressableScale(
      onTap: enabled ? onTap : null,
      child: AnimatedOpacity(
        opacity: (enabled || busy) ? 1.0 : 0.42,
        duration: const Duration(milliseconds: 200),
        child: Container(
          height: 138,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                c.withValues(alpha: 0.20),
                c.withValues(alpha: 0.05),
              ],
            ),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: c.withValues(alpha: enabled ? 0.55 : 0.25),
              width: 1.4,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  gradient: directionGradient(direction),
                  shape: BoxShape.circle,
                  boxShadow: AppShadows.glow(c),
                ),
                child:
                    busy
                        ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                        : Icon(
                          directionIcon(direction),
                          color: Colors.white,
                          size: 27,
                        ),
              ),
              const SizedBox(height: 10),
              Text(
                directionLabel(direction),
                style: TextStyle(
                  color: c,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.2,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                'Gain ${fmtSigned(profit)}',
                style: TextStyle(
                  color: context.textSecondary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String text;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _Notice({
    required this.icon,
    required this.color,
    required this.text,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: context.textPrimary,
                fontSize: 12.5,
                height: 1.35,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(width: 8),
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                foregroundColor: color,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                minimumSize: const Size(0, 32),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(
                actionLabel!,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ═════════════════════════════════════════════
//  FEUILLE DE CONFIRMATION
// ═════════════════════════════════════════════

class ConfirmBetSheet extends StatelessWidget {
  final PredictionProvider provider;
  final String direction;
  final double amount;

  const ConfirmBetSheet({
    super.key,
    required this.provider,
    required this.direction,
    required this.amount,
  });

  @override
  Widget build(BuildContext context) {
    final cfg = provider.config!;
    final c = directionColor(direction);
    final payout = amount * cfg.winMultiplier;
    final profit = payout - amount;

    return SheetFrame(
      child: ListenableBuilder(
        listenable: provider,
        builder: (ctx, _) {
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Confirmer votre pari',
                style: TextStyle(
                  color: ctx.textPrimary,
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  gradient: directionGradient(direction),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: AppShadows.glow(c),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(directionIcon(direction), color: Colors.white),
                    const SizedBox(width: 10),
                    Text(
                      direction == 'UP'
                          ? 'Je parie sur la hausse'
                          : 'Je parie sur la baisse',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _Line(
                label: 'Mise',
                value: '${fmtAmount(amount)} ${cfg.currencySymbol}',
              ),
              _Line(label: 'Durée', value: durationLabel(cfg.durationSeconds)),
              _Line(
                label: 'Prix de référence',
                value: '≈ ${fmtUsd(provider.currentPrice)}',
              ),
              _Line(
                label: 'Profit si gagné',
                value: '${fmtSigned(profit)} ${cfg.currencySymbol}',
                color: AppColors.bullish,
              ),
              _Line(
                label: 'Perte si perdu',
                value: '${fmtSigned(-amount)} ${cfg.currencySymbol}',
                color: AppColors.bearish,
                last: true,
              ),
              const SizedBox(height: 12),
              Text(
                'Le prix de référence est celui relevé à la validation. '
                'Prix identique à l\'échéance : mise remboursée.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: ctx.textSecondary,
                  fontSize: 11.5,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 52,
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: ctx.textPrimary,
                          side: BorderSide(color: ctx.borderColor),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: const Text(
                          'Annuler',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: PredGradientButton(
                      label: 'Confirmer',
                      icon: Icons.check_rounded,
                      gradient: directionGradient(direction),
                      glow: c,
                      onTap:
                          provider.isPriceReady
                              ? () => Navigator.pop(ctx, true)
                              : null,
                    ),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Line extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  final bool last;
  const _Line({
    required this.label,
    required this.value,
    this.color,
    this.last = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 11),
      decoration: BoxDecoration(
        border:
            last
                ? null
                : Border(bottom: BorderSide(color: context.borderColor)),
      ),
      child: Row(
        children: [
          Text(
            label,
            style: TextStyle(
              color: context.textSecondary,
              fontSize: 13.5,
              fontWeight: FontWeight.w500,
            ),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              color: color ?? context.textPrimary,
              fontSize: 14.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

// ═════════════════════════════════════════════
//  FEUILLE « COMMENT ÇA MARCHE ? »
// ═════════════════════════════════════════════

Future<void> showRulesSheet(BuildContext context, PredictionConfig cfg) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) {
      final mult = fmtNumber(cfg.winMultiplier, decimals: 2, trimZeros: true);
      final stake =
          cfg.betMode == 'fixed'
              ? '${fmtAmount(cfg.betAmount)} ${cfg.currencySymbol}'
              : 'entre ${fmtAmount(cfg.betMin)} et ${fmtAmount(cfg.betMax)} ${cfg.currencySymbol}';
      return SheetFrame(
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Comment ça marche ?',
                style: TextStyle(
                  color: ctx.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 18),
              _RuleStep(
                n: '1',
                title: 'Choisissez Hausse ou Baisse',
                text:
                    'Prédisez si le prix du ${cfg.assetName} sera plus haut ou plus bas dans ${durationLabel(cfg.durationSeconds)}.',
              ),
              _RuleStep(
                n: '2',
                title: 'Attendez le résultat',
                text:
                    'Le prix de référence est relevé au moment de votre pari. Le compte à rebours démarre aussitôt.',
              ),
              _RuleStep(
                n: '3',
                title: 'Encaissez si vous avez vu juste',
                text:
                    'Gagné : vous recevez ${mult}× votre mise. Perdu : la mise est perdue.',
              ),
              const SizedBox(height: 6),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: ctx.surfaceHighColor,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _Bullet('Mise : $stake'),
                    _Bullet('Limite : ${cfg.maxBetsPerDay} paris par jour'),
                    _Bullet('Prix identique à l\'échéance : mise remboursée'),
                    _Bullet('Un seul pari actif à la fois'),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline_rounded,
                    size: 16,
                    color: AppColors.warning,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Ce jeu comporte un risque de perte de la mise. '
                      'Ne jouez que ce que vous pouvez vous permettre de perdre.',
                      style: TextStyle(
                        color: ctx.textSecondary,
                        fontSize: 12,
                        height: 1.45,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: PredGradientButton(
                  label: 'Compris',
                  gradient: AppColors.primaryGradient,
                  glow: AppColors.primary,
                  onTap: () => Navigator.pop(ctx),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _RuleStep extends StatelessWidget {
  final String n;
  final String title;
  final String text;
  const _RuleStep({required this.n, required this.title, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              gradient: AppColors.primaryGradient,
              shape: BoxShape.circle,
            ),
            child: Text(
              n,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
                fontSize: 14,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: context.textPrimary,
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  text,
                  style: TextStyle(
                    color: context.textSecondary,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Bullet extends StatelessWidget {
  final String text;
  const _Bullet(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(
                color: context.textSecondary,
                shape: BoxShape.circle,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: context.textPrimary,
                fontSize: 13,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ═════════════════════════════════════════════
//  CARTE D'ACCUEIL (nouveaux joueurs)
// ═════════════════════════════════════════════

class OnboardingCard extends StatelessWidget {
  final PredictionConfig cfg;
  const OnboardingCard({super.key, required this.cfg});

  @override
  Widget build(BuildContext context) {
    final mult = fmtNumber(cfg.winMultiplier, decimals: 2, trimZeros: true);
    return PredCard(
      padding: const EdgeInsets.all(18),
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          AppColors.primary.withValues(alpha: 0.16),
          AppColors.secondary.withValues(alpha: 0.06),
        ],
      ),
      borderColor: AppColors.primary.withValues(alpha: 0.35),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Premier pari ? Voici comment jouer',
            style: TextStyle(
              color: context.textPrimary,
              fontSize: 15.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _OnbStep(
                  icon: Icons.touch_app_rounded,
                  title: 'Choisissez',
                  text: 'Hausse ou baisse',
                ),
              ),
              Expanded(
                child: _OnbStep(
                  icon: Icons.timer_rounded,
                  title: 'Patientez',
                  text: durationLabel(cfg.durationSeconds),
                ),
              ),
              Expanded(
                child: _OnbStep(
                  icon: Icons.emoji_events_rounded,
                  title: 'Gagnez',
                  text: '$mult× la mise',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _OnbStep extends StatelessWidget {
  final IconData icon;
  final String title;
  final String text;
  const _OnbStep({
    required this.icon,
    required this.title,
    required this.text,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.16),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: AppColors.primary, size: 22),
        ),
        const SizedBox(height: 8),
        Text(
          title,
          style: TextStyle(
            color: context.textPrimary,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.textSecondary, fontSize: 12),
        ),
      ],
    );
  }
}
