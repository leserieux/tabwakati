// lib/screens/lending/stake_loan_screen.dart
// ============================================================================
// ÉCRAN PRÊT — un seul système : le prêt adossé au staking (WAKATI, BTC, FCFA…).
//   • Une part du stake est bloquée en garantie (elle continue de rapporter).
//   • L'user choisit l'actif, le montant et la durée.
//   • Échéance → délai de grâce → saisie automatique de la garantie.
// Remplace loan_hub_screen / loan_screen / score_loan_screen.
// ============================================================================

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/models/stake_loan_model.dart';
import 'package:wakati/providers/app_provider.dart';
import 'package:wakati/providers/stake_loan_provider.dart';
import 'package:wakati/screens/home/widgets/asset_icon.dart';
import 'stake_loan_format.dart';
import 'stake_loan_sheets.dart';

class StakeLoanScreen extends StatefulWidget {
  const StakeLoanScreen({super.key});

  @override
  State<StakeLoanScreen> createState() => _StakeLoanScreenState();
}

class _StakeLoanScreenState extends State<StakeLoanScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final p = context.read<StakeLoanProvider>();
      // Première visite : tout charger. Ensuite : rafraîchir seulement mes prêts.
      p.hasLoaded ? p.loadMyLoans() : p.refreshAll();
    });
  }

  /// Après une action réussie : soldes et staking changent (garantie, fonds reçus).
  void _afterAction(String message) {
    if (!mounted) return;
    final app = context.read<AppProvider>();
    app.balance.refreshBalances();
    app.staking.loadState();
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _newLoan(StakeLoanProvider p) async {
    final r = await showNewLoanSheet(context, p);
    if (r != null && r.success) {
      _afterAction(
        'Prêt accordé : tu reçois ${fmtAmount(r.raw['borrow_asset'] as String? ?? '', r.netReceived)}',
      );
    }
  }

  Future<void> _repay(StakeLoanProvider p, StakeLoan loan) async {
    final app = context.read<AppProvider>();
    final available = app.balance.availableBalances[loan.borrowAsset] ?? 0.0;
    final r = await showRepaySheet(context, p, loan, available);
    if (r != null && r.success) {
      _afterAction(
        r.fullyRepaid
            ? 'Prêt soldé : ${fmtAmount(loan.collateralAsset, r.collateralReleased)} débloqués'
            : 'Remboursement de ${fmtAmount(loan.borrowAsset, r.repaid)} effectué',
      );
    }
  }

  Future<void> _extend(StakeLoanProvider p, StakeLoan loan) async {
    final r = await showExtendSheet(context, p, loan);
    if (r != null && r.success && r.newDueAt != null) {
      _afterAction('Prêt prolongé jusqu\'au ${fmtDate(r.newDueAt!)}');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      body: Consumer<StakeLoanProvider>(
        builder: (context, p, _) {
          if (p.isLoading && !p.hasLoaded) {
            return Center(child: AppLoader(color: AppColors.primary));
          }
          return RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: context.surfaceHighColor,
            onRefresh: p.refreshAll,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                _StakeCard(
                  options: p.options,
                  collaterals: p.collaterals,
                  selected: p.selectedCollateral,
                  onSelect: p.selectCollateral,
                  onBorrow: () => _newLoan(p),
                ),
                if (p.errorMessage != null) ...[
                  const SizedBox(height: 12),
                  _ErrorBanner(
                    message: p.errorMessage!,
                    onDismiss: p.clearError,
                  ),
                ],
                const SizedBox(height: 20),
                if (p.activeLoans.isNotEmpty) ...[
                  Text(
                    'Mes prêts',
                    style: AppText.h2.copyWith(color: context.textPrimary),
                  ),
                  const SizedBox(height: 12),
                  for (final loan in p.activeLoans) ...[
                    _LoanCard(
                      loan: loan,
                      onRepay: () => _repay(p, loan),
                      onExtend: () => _extend(p, loan),
                    ),
                    const SizedBox(height: 12),
                  ],
                ] else if (p.options.enabled)
                  _HowItWorks(terms: p.options.terms),
                if (p.history.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  _HistorySection(records: p.history),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CARTE STAKE : ce que j'ai de libre et ce que je peux emprunter
// ════════════════════════════════════════════════════════════════════════════

class _StakeCard extends StatelessWidget {
  final StakeLoanOptions options;
  final List<StakeLoanCollateral> collaterals;
  final String selected;
  final ValueChanged<String> onSelect;
  final VoidCallback onBorrow;

  const _StakeCard({
    required this.options,
    required this.collaterals,
    required this.selected,
    required this.onSelect,
    required this.onBorrow,
  });

  @override
  Widget build(BuildContext context) {
    final o = options;
    final canBorrow =
        o.enabled && o.stakeFree > 0 && o.availableAssets.isNotEmpty;

    String? blocked;
    if (!o.enabled) {
      blocked = 'Prêts indisponibles pour le moment';
    } else if (!o.hasStake) {
      blocked = 'Mets des actifs en staking pour emprunter';
    } else if (o.stakeFree <= 0) {
      blocked = 'Tout ton stake est bloqué en garantie';
    } else if (o.availableAssets.isEmpty) {
      blocked = 'Aucun actif empruntable pour le moment';
    }

    return AppCard(
      showBorder: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Choix de la garantie (visible dès qu'il y a plusieurs actifs stakés)
          if (collaterals.length > 1) ...[
            Text(
              'Garantie',
              style: AppText.l2.copyWith(color: context.textSecondary),
            ),
            const SizedBox(height: 10),
            _CollateralPicker(
              collaterals: collaterals,
              selected: selected,
              onSelect: onSelect,
            ),
            const SizedBox(height: 16),
          ],
          if (blocked == null) ...[
            Text(
              'Tu peux emprunter jusqu\'à',
              style: AppText.l2.copyWith(color: context.textSecondary),
            ),
            const SizedBox(height: 10),
            for (final a in o.availableAssets)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: _BorrowRow(asset: a),
              ),
            const SizedBox(height: 10),
          ],
          _Row(
            label: 'Garantie disponible',
            value: fmtAmount(o.collateralSymbol, o.stakeFree),
          ),
          if (o.stakeLocked > 0)
            _Row(
              label: 'Déjà bloquée',
              value: fmtAmount(o.collateralSymbol, o.stakeLocked),
            ),
          const SizedBox(height: 16),
          if (blocked != null)
            Text(
              blocked,
              style: AppText.b2.copyWith(color: context.textSecondary),
            )
          else
            AppButton(
              label: 'Emprunter',
              onPressed: canBorrow ? onBorrow : null,
            ),
        ],
      ),
    );
  }
}

/// Choix de l'actif stakeé donné en garantie.
class _CollateralPicker extends StatelessWidget {
  final List<StakeLoanCollateral> collaterals;
  final String selected;
  final ValueChanged<String> onSelect;

  const _CollateralPicker({
    required this.collaterals,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final c in collaterals)
          GestureDetector(
            onTap: () => onSelect(c.symbol),
            behavior: HitTestBehavior.opaque,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color:
                    c.symbol == selected
                        ? AppColors.primary.withOpacity(0.12)
                        : null,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color:
                      c.symbol == selected
                          ? AppColors.primary
                          : context.borderColor,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AssetIcon(symbol: c.symbol, size: 18),
                  const SizedBox(width: 6),
                  Text(
                    c.symbol,
                    style: AppText.l2.copyWith(
                      color:
                          c.symbol == selected
                              ? context.textPrimary
                              : context.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Montant empruntable : c'est l'information clé de la carte, donc en grand.
class _BorrowRow extends StatelessWidget {
  final StakeLoanAsset asset;
  const _BorrowRow({required this.asset});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        AssetIcon(symbol: asset.symbol, size: 28),
        const SizedBox(width: 10),
        Text(
          fmtAmount(
            asset.symbol,
            floorTo(asset.maxBorrow, assetDecimals(asset.symbol)),
          ),
          style: AppText.price1.copyWith(
            color: context.textPrimary,
            fontSize: 28,
          ),
        ),
      ],
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CARTE PRÊT ACTIF
// ════════════════════════════════════════════════════════════════════════════

Color _riskColor(StakeLoanRisk r) {
  switch (r) {
    case StakeLoanRisk.safe:
      return AppColors.bullish;
    case StakeLoanRisk.warning:
      return AppColors.warning;
    case StakeLoanRisk.critical:
      return AppColors.bearish;
  }
}

class _LoanCard extends StatelessWidget {
  final StakeLoan loan;
  final VoidCallback onRepay;
  final VoidCallback onExtend;

  const _LoanCard({
    required this.loan,
    required this.onRepay,
    required this.onExtend,
  });

  @override
  Widget build(BuildContext context) {
    final inGrace = loan.phase != StakeLoanPhase.running;
    return AppCard(
      showBorder: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AssetIcon(symbol: loan.borrowAsset, size: 32),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'À rembourser',
                      style: AppText.l2.copyWith(color: context.textSecondary),
                    ),
                    Text(
                      fmtAmount(loan.borrowAsset, loan.debt),
                      style: AppText.price3.copyWith(
                        color: context.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
              _PhaseChip(loan: loan),
            ],
          ),
          const SizedBox(height: 16),
          _HealthGauge(loan: loan),
          const SizedBox(height: 14),
          _DeadlineLine(loan: loan),
          if (inGrace) ...[
            const SizedBox(height: 10),
            _GraceBanner(loan: loan),
          ],
          const SizedBox(height: 14),
          _Row(
            label: 'Emprunté',
            value: fmtAmount(loan.borrowAsset, loan.principal),
          ),
          _Row(
            label: 'Intérêts (${fmtPct(loan.aprPct)} %/an)',
            value: fmtAmount(loan.borrowAsset, loan.interest),
          ),
          _Row(
            label: 'Garantie',
            value: fmtAmount(loan.collateralAsset, loan.collateralAmount),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: AppButton(label: 'Rembourser', onPressed: onRepay),
              ),
              if (loan.canExtend) ...[
                const SizedBox(width: 10),
                Expanded(
                  child: SizedBox(
                    height: 48,
                    child: OutlinedButton(
                      onPressed: onExtend,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: context.textPrimary,
                        side: BorderSide(color: context.borderColor),
                        shape: RoundedRectangleBorder(
                          borderRadius: AppSpacing.button,
                        ),
                      ),
                      child: Text('Prolonger', style: AppText.l1),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _PhaseChip extends StatelessWidget {
  final StakeLoan loan;
  const _PhaseChip({required this.loan});

  @override
  Widget build(BuildContext context) {
    late final String label;
    late final Color color;
    switch (loan.phase) {
      case StakeLoanPhase.running:
        label = 'En cours';
        color = AppColors.bullish;
        break;
      case StakeLoanPhase.grace:
        label = 'Dernier délai';
        color = AppColors.warning;
        break;
      case StakeLoanPhase.overdue:
        label = 'Saisie imminente';
        color = AppColors.bearish;
        break;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: AppSpacing.tag,
      ),
      child: Text(label, style: AppText.l2.copyWith(color: color)),
    );
  }
}

/// Jauge de la garantie : la barre se remplit à mesure que la dette approche
/// du seuil de saisie. C'est l'indicateur central de l'écran.
class _HealthGauge extends StatelessWidget {
  final StakeLoan loan;
  const _HealthGauge({required this.loan});

  @override
  Widget build(BuildContext context) {
    final color = _riskColor(loan.risk);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: Stack(
            children: [
              Container(height: 8, color: context.surfaceHighColor),
              FractionallySizedBox(
                widthFactor: loan.healthUsed < 0.03 ? 0.03 : loan.healthUsed,
                child: Container(height: 8, color: color),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Dette ${fmtPct(loan.ltvPct)} %',
              style: AppText.b3.copyWith(color: context.textSecondary),
            ),
            Text(
              'Saisie à ${fmtPct(loan.liquidationLtvPct)} %',
              style: AppText.b3.copyWith(color: context.textSecondary),
            ),
          ],
        ),
      ],
    );
  }
}

class _DeadlineLine extends StatelessWidget {
  final StakeLoan loan;
  const _DeadlineLine({required this.loan});

  @override
  Widget build(BuildContext context) {
    String text;
    if (loan.phase == StakeLoanPhase.running && loan.dueAt != null) {
      text =
          'Échéance ${fmtDate(loan.dueAt!)} · ${fmtRemaining(loan.timeToDue ?? Duration.zero)}';
    } else if (loan.graceUntil != null) {
      text =
          'Échéance dépassée · saisie dans ${fmtRemaining(loan.timeToSeizure ?? Duration.zero)}';
    } else {
      text = 'Échéance dépassée';
    }
    return Row(
      children: [
        Icon(Icons.schedule_rounded, size: 16, color: context.textSecondary),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: AppText.b2.copyWith(color: context.textPrimary),
          ),
        ),
      ],
    );
  }
}

class _GraceBanner extends StatelessWidget {
  final StakeLoan loan;
  const _GraceBanner({required this.loan});

  @override
  Widget build(BuildContext context) {
    final until = loan.graceUntil;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.warningDim,
        borderRadius: AppSpacing.button,
      ),
      child: Text(
        until == null
            ? 'Rembourse maintenant pour éviter la saisie'
            : 'Rembourse${loan.canExtend ? ' ou prolonge' : ''} avant le ${fmtDate(until)}',
        style: AppText.b3.copyWith(color: context.textPrimary, height: 1.4),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;
  const _Row({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: Text(
              label,
              style: AppText.b3.copyWith(color: context.textSecondary),
            ),
          ),
          const SizedBox(width: 12),
          Text(value, style: AppText.l2.copyWith(color: context.textPrimary)),
        ],
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// COMMENT ÇA MARCHE (affiché tant que l'user n'a aucun prêt actif)
// ════════════════════════════════════════════════════════════════════════════

class _HowItWorks extends StatefulWidget {
  final StakeLoanTerms terms;
  const _HowItWorks({required this.terms});

  @override
  State<_HowItWorks> createState() => _HowItWorksState();
}

class _HowItWorksState extends State<_HowItWorks> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final t = widget.terms;
    final fee =
        t.originationFeePct > 0 ? ' · frais ${fmtPct(t.originationFeePct)} %' : '';
    final ext =
        t.maxExtensions > 0 ? ' · prolongeable ${t.maxExtensions} fois' : '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => setState(() => _open = !_open),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Comment ça marche',
                    style: AppText.h2.copyWith(color: context.textPrimary),
                  ),
                ),
                AnimatedRotation(
                  turns: _open ? 0.5 : 0,
                  duration: const Duration(milliseconds: 160),
                  child: Icon(
                    Icons.keyboard_arrow_down_rounded,
                    color: context.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          alignment: Alignment.topCenter,
          child:
              _open
                  ? Column(
                    children: [
                      const SizedBox(height: 4),
                      _Step(
                        icon: Icons.lock_outline_rounded,
                        text:
                            'Garantie : jusqu\'à ${fmtPct(t.maxLtvPct)} % de ton stake$fee',
                      ),
                      _Step(
                        icon: Icons.event_available_rounded,
                        text:
                            'Durée : ${t.minDurationDays} à ${t.maxDurationDays} jours$ext',
                      ),
                      _Step(
                        icon: Icons.gavel_rounded,
                        text: 'Non remboursé : saisie après ${t.gracePeriodHours} h',
                      ),
                    ],
                  )
                  : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}

class _Step extends StatelessWidget {
  final IconData icon;
  final String text;
  const _Step({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.primary),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: AppText.b2.copyWith(color: context.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HISTORIQUE
// ════════════════════════════════════════════════════════════════════════════

class _HistorySection extends StatefulWidget {
  final List<StakeLoanRecord> records;
  const _HistorySection({required this.records});

  @override
  State<_HistorySection> createState() => _HistorySectionState();
}

class _HistorySectionState extends State<_HistorySection> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: () => setState(() => _open = !_open),
          borderRadius: AppSpacing.button,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Historique (${widget.records.length})',
                    style: AppText.h2.copyWith(color: context.textPrimary),
                  ),
                ),
                Icon(
                  _open ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                  color: context.textSecondary,
                ),
              ],
            ),
          ),
        ),
        if (_open)
          for (final r in widget.records) _HistoryRow(record: r),
      ],
    );
  }
}

class _HistoryRow extends StatelessWidget {
  final StakeLoanRecord record;
  const _HistoryRow({required this.record});

  @override
  Widget build(BuildContext context) {
    final repaid = record.isRepaid;
    final color = repaid ? AppColors.bullish : AppColors.bearish;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        showBorder: true,
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(
              repaid ? Icons.check_circle_outline_rounded : Icons.gavel_rounded,
              color: color,
              size: 20,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    fmtAmount(record.borrowAsset, record.principal),
                    style: AppText.l1.copyWith(color: context.textPrimary),
                  ),
                  Text(
                    record.closedAt != null
                        ? 'Clôturé le ${fmtDate(record.closedAt!)}'
                        : '',
                    style: AppText.b3.copyWith(color: context.textSecondary),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  repaid ? 'Remboursé' : 'Garantie saisie',
                  style: AppText.l2.copyWith(color: color),
                ),
                if (!repaid && record.seized > 0)
                  Text(
                    fmtAmount(record.collateralAsset, record.seized),
                    style: AppText.b3.copyWith(color: context.textSecondary),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;
  final VoidCallback onDismiss;
  const _ErrorBanner({required this.message, required this.onDismiss});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.bearishDim,
        borderRadius: AppSpacing.button,
      ),
      child: Row(
        children: [
          const Icon(
            Icons.error_outline_rounded,
            size: 18,
            color: AppColors.bearish,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: AppText.b3.copyWith(color: context.textPrimary),
            ),
          ),
          GestureDetector(
            onTap: onDismiss,
            child: Icon(
              Icons.close_rounded,
              size: 18,
              color: context.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
