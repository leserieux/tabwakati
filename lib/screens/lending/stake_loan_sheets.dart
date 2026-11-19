// lib/screens/lending/stake_loan_sheets.dart
// Feuilles d'action du prêt sur staking : nouveau prêt, remboursement, prolongation.
// Chaque feuille se ferme avec le [StakeLoanActionResult] (ou null si annulée) ;
// l'écran appelant se charge de rafraîchir les soldes et d'afficher la confirmation.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/models/stake_loan_model.dart';
import 'package:wakati/providers/stake_loan_provider.dart';
import 'package:wakati/screens/home/widgets/asset_icon.dart';
import 'stake_loan_format.dart';

Future<StakeLoanActionResult?> showNewLoanSheet(
  BuildContext context,
  StakeLoanProvider provider,
) {
  return showModalBottomSheet<StakeLoanActionResult>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder:
        (_) => ChangeNotifierProvider.value(
          value: provider,
          child: const _NewLoanSheet(),
        ),
  );
}

Future<StakeLoanActionResult?> showRepaySheet(
  BuildContext context,
  StakeLoanProvider provider,
  StakeLoan loan,
  double availableBalance,
) {
  return showModalBottomSheet<StakeLoanActionResult>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder:
        (_) => ChangeNotifierProvider.value(
          value: provider,
          child: _RepaySheet(loan: loan, availableBalance: availableBalance),
        ),
  );
}

Future<StakeLoanActionResult?> showExtendSheet(
  BuildContext context,
  StakeLoanProvider provider,
  StakeLoan loan,
) {
  return showModalBottomSheet<StakeLoanActionResult>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder:
        (_) => ChangeNotifierProvider.value(
          value: provider,
          child: _ExtendSheet(loan: loan),
        ),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CADRE COMMUN
// ════════════════════════════════════════════════════════════════════════════

class _SheetFrame extends StatelessWidget {
  final String title;
  final Widget child;
  const _SheetFrame({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Container(
        decoration: BoxDecoration(
          color: context.surfaceColor,
          borderRadius: AppSpacing.sheet,
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: context.borderColor,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  title,
                  style: AppText.h1.copyWith(color: context.textPrimary),
                ),
                const SizedBox(height: 16),
                child,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  final bool strong;
  const _SummaryRow({
    required this.label,
    required this.value,
    this.strong = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: Text(
              label,
              style: (strong ? AppText.l1 : AppText.b2).copyWith(
                color: strong ? context.textPrimary : context.textSecondary,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: (strong ? AppText.h2 : AppText.l1).copyWith(
                color: context.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryBox extends StatelessWidget {
  final List<Widget> children;
  const _SummaryBox({required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.surfaceHighColor,
        borderRadius: AppSpacing.card,
      ),
      child: Column(children: children),
    );
  }
}

class _Notice extends StatelessWidget {
  final String text;
  final Color color;
  const _Notice({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: AppSpacing.button,
      ),
      child: Text(
        text,
        style: AppText.b3.copyWith(color: context.textPrimary, height: 1.4),
      ),
    );
  }
}

/// Mention obligatoire : une ligne, très petite, sans encadré.
class LoanFinePrint extends StatelessWidget {
  final String text;
  const LoanFinePrint(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      textAlign: TextAlign.center,
      style: AppText.b3.copyWith(
        color: context.textSecondary,
        fontSize: 10.5,
        height: 1.35,
      ),
    );
  }
}

InputDecoration _amountDecoration(BuildContext context, String suffix) {
  return InputDecoration(
    hintText: '0',
    suffixText: suffix,
    filled: true,
    fillColor: context.surfaceHighColor,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    border: OutlineInputBorder(
      borderRadius: AppSpacing.input,
      borderSide: BorderSide.none,
    ),
  );
}

double _parse(String v) => double.tryParse(v.replaceAll(',', '.').trim()) ?? 0;

final _decimalOnly = FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'));

// ════════════════════════════════════════════════════════════════════════════
// NOUVEAU PRÊT
// ════════════════════════════════════════════════════════════════════════════

class _NewLoanSheet extends StatefulWidget {
  const _NewLoanSheet();

  @override
  State<_NewLoanSheet> createState() => _NewLoanSheetState();
}

class _NewLoanSheetState extends State<_NewLoanSheet> {
  final TextEditingController _ctrl = TextEditingController();
  String? _asset;
  double _amount = 0;
  late int _days;
  String? _error;

  @override
  void initState() {
    super.initState();
    final o = context.read<StakeLoanProvider>().options;
    final t = o.terms;
    _days =
        t.defaultDurationDays
            .clamp(t.minDurationDays, t.maxDurationDays)
            .toInt();
    final avail = o.availableAssets;
    if (avail.isNotEmpty) _asset = avail.first.symbol;
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _selectAsset(String symbol) {
    setState(() {
      _asset = symbol;
      _error = null;
      // Le montant saisi pour un autre actif n'a plus de sens.
      _ctrl.clear();
      _amount = 0;
    });
  }

  Future<void> _submit() async {
    final provider = context.read<StakeLoanProvider>();
    final nav = Navigator.of(context);
    setState(() => _error = null);
    final result = await provider.openLoan(
      borrowAsset: _asset!,
      amount: _amount,
      durationDays: _days,
    );
    if (!mounted) return;
    if (result != null && result.success) {
      nav.pop(result);
    } else {
      setState(
        () =>
            _error =
                result?.error ??
                provider.errorMessage ??
                'Impossible d\'ouvrir le prêt',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<StakeLoanProvider>();
    final o = p.options;
    final t = o.terms;
    final asset = _asset == null ? null : o.assetBySymbol(_asset!);

    // Calculs du récapitulatif (estimation ; le serveur fait foi).
    final fee = asset == null ? 0.0 : _amount * t.originationFeePct / 100;
    final net = _amount - fee;
    final interest =
        asset == null ? 0.0 : _amount * asset.aprPct / 100 * _days / 365;
    final collateral = asset == null ? 0.0 : o.collateralFor(_amount, asset);
    final due = DateTime.now().add(Duration(days: _days));

    String? amountHint;
    if (asset != null && _amount > 0) {
      if (_amount < asset.minBorrow) {
        amountHint = 'Minimum : ${fmtAmount(asset.symbol, asset.minBorrow)}';
      } else if (_amount > asset.maxBorrow + 1e-9) {
        amountHint =
            'Maximum : ${fmtAmount(asset.symbol, floorTo(asset.maxBorrow, assetDecimals(asset.symbol)))}';
      }
    }
    final valid =
        asset != null &&
        asset.isAvailable &&
        _amount >= asset.minBorrow &&
        _amount <= asset.maxBorrow + 1e-9 &&
        amountHint == null;

    return _SheetFrame(
      title: 'Nouveau prêt',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Actif à emprunter',
            style: AppText.l2.copyWith(color: context.textSecondary),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final a in o.assets)
                _AssetChoice(
                  asset: a,
                  selected: a.symbol == _asset,
                  onTap: a.isAvailable ? () => _selectAsset(a.symbol) : null,
                ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Montant',
            style: AppText.l2.copyWith(color: context.textSecondary),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _ctrl,
            enabled: asset != null,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [_decimalOnly],
            style: AppText.price2.copyWith(color: context.textPrimary),
            decoration: _amountDecoration(context, _asset ?? ''),
            onChanged:
                (v) => setState(() {
                  _amount = _parse(v);
                  _error = null;
                }),
          ),
          if (asset != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Text(
                    amountHint ?? '',
                    style: AppText.b3.copyWith(color: AppColors.bearish),
                  ),
                ),
                GestureDetector(
                  onTap: () {
                    final m = floorTo(
                      asset.maxBorrow,
                      assetDecimals(asset.symbol),
                    );
                    _ctrl.text = fmtInput(asset.symbol, m);
                    setState(() {
                      _amount = m;
                      _error = null;
                    });
                  },
                  child: Text(
                    'Max',
                    style: AppText.l1.copyWith(color: AppColors.primary),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Durée',
                style: AppText.l2.copyWith(color: context.textSecondary),
              ),
              Text(
                '$_days jours',
                style: AppText.l1.copyWith(color: context.textPrimary),
              ),
            ],
          ),
          if (t.maxDurationDays > t.minDurationDays)
            Slider(
              value: _days.toDouble(),
              min: t.minDurationDays.toDouble(),
              max: t.maxDurationDays.toDouble(),
              divisions: t.maxDurationDays - t.minDurationDays,
              activeColor: AppColors.primary,
              onChanged: (v) => setState(() => _days = v.round()),
            )
          else
            const SizedBox(height: 8),
          if (valid && asset != null) ...[
            const SizedBox(height: 4),
            _SummaryBox(
              children: [
                _SummaryRow(
                  label: 'Tu reçois',
                  value: fmtAmount(asset.symbol, net),
                  strong: true,
                ),
                if (fee > 0)
                  _SummaryRow(
                    label: 'Frais (${fmtPct(t.originationFeePct)} %)',
                    value: fmtAmount(asset.symbol, fee),
                  ),
                _SummaryRow(
                  label: 'Intérêts (${fmtPct(asset.aprPct)} %/an)',
                  value: fmtAmount(asset.symbol, interest),
                ),
                _SummaryRow(
                  label: 'À rembourser',
                  value: fmtAmount(asset.symbol, _amount + interest),
                ),
                _SummaryRow(label: 'Échéance', value: fmtDate(due)),
                _SummaryRow(
                  label: 'Garantie',
                  value: fmtAmount(o.collateralSymbol, collateral),
                ),
              ],
            ),
            const SizedBox(height: 10),
            LoanFinePrint(
              'Non remboursé ${t.gracePeriodHours} h après l\'échéance : garantie saisie à hauteur de la dette${t.penaltyPct > 0 ? ' (pénalité ${fmtPct(t.penaltyPct)} % sur le surplus)' : ''}.',
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            _Notice(color: AppColors.bearish, text: _error!),
          ],
          const SizedBox(height: 16),
          AppButton(
            label:
                (valid && asset != null)
                    ? 'Emprunter ${fmtAmount(asset.symbol, _amount)}'
                    : 'Emprunter',
            loading: p.isSubmitting,
            onPressed: valid && !p.isSubmitting ? _submit : null,
          ),
        ],
      ),
    );
  }
}

class _AssetChoice extends StatelessWidget {
  final StakeLoanAsset asset;
  final bool selected;
  final VoidCallback? onTap;
  const _AssetChoice({required this.asset, required this.selected, this.onTap});

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Opacity(
      opacity: enabled ? 1 : 0.4,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? AppColors.primaryDim : context.surfaceHighColor,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected ? AppColors.primary : Colors.transparent,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AssetIcon(symbol: asset.symbol, size: 20),
              const SizedBox(width: 6),
              Text(
                asset.symbol,
                style: AppText.l1.copyWith(color: context.textPrimary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REMBOURSEMENT
// ════════════════════════════════════════════════════════════════════════════

class _RepaySheet extends StatefulWidget {
  final StakeLoan loan;
  final double availableBalance;
  const _RepaySheet({required this.loan, required this.availableBalance});

  @override
  State<_RepaySheet> createState() => _RepaySheetState();
}

class _RepaySheetState extends State<_RepaySheet> {
  final TextEditingController _ctrl = TextEditingController();
  double _amount = 0;
  String? _error;

  StakeLoan get _loan => widget.loan;
  // Le plus que l'user peut payer maintenant.
  double get _maxPay =>
      widget.availableBalance < _loan.debt
          ? widget.availableBalance
          : _loan.debt;
  bool get _coversAll => widget.availableBalance >= _loan.debt;

  @override
  void initState() {
    super.initState();
    final start = floorTo(_maxPay, assetDecimals(_loan.borrowAsset));
    if (start > 0) {
      _amount = _coversAll ? _loan.debt : start;
      _ctrl.text = fmtInput(_loan.borrowAsset, _amount);
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final provider = context.read<StakeLoanProvider>();
    final nav = Navigator.of(context);
    setState(() => _error = null);
    final result = await provider.repay(loanId: _loan.id, amount: _amount);
    if (!mounted) return;
    if (result != null && result.success) {
      nav.pop(result);
    } else {
      setState(
        () =>
            _error =
                result?.error ??
                provider.errorMessage ??
                'Impossible de rembourser',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<StakeLoanProvider>();
    final asset = _loan.borrowAsset;
    // Montant saisi proche de la dette : on l'envoie tel quel, le serveur plafonne.
    final isFull =
        _amount >= _loan.debt - 1e-9 ||
        (_amount > 0 && (_loan.debt - _amount) / _loan.debt < 0.0001);
    final double remaining =
        isFull
            ? 0.0
            : (_loan.debt - _amount).clamp(0.0, double.infinity).toDouble();
    final tooMuch = _amount > widget.availableBalance + 1e-9;
    final valid = _amount > 0 && !tooMuch;

    return _SheetFrame(
      title: 'Rembourser',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SummaryBox(
            children: [
              _SummaryRow(
                label: 'Dette actuelle',
                value: fmtAmount(asset, _loan.debt),
                strong: true,
              ),
              _SummaryRow(
                label: 'Ton solde',
                value: fmtAmount(asset, widget.availableBalance),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Montant à rembourser',
            style: AppText.l2.copyWith(color: context.textSecondary),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _ctrl,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [_decimalOnly],
            style: AppText.price2.copyWith(color: context.textPrimary),
            decoration: _amountDecoration(context, asset),
            onChanged:
                (v) => setState(() {
                  _amount = _parse(v);
                  _error = null;
                }),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: Text(
                  tooMuch
                      ? 'Solde insuffisant'
                      : (_coversAll
                          ? 'Tu peux tout rembourser'
                          : 'Ton solde ne couvre pas toute la dette'),
                  style: AppText.b3.copyWith(
                    color: tooMuch ? AppColors.bearish : context.textSecondary,
                  ),
                ),
              ),
              GestureDetector(
                onTap: () {
                  final v =
                      _coversAll
                          ? _loan.debt
                          : floorTo(_maxPay, assetDecimals(asset));
                  _ctrl.text = fmtInput(asset, v);
                  setState(() {
                    _amount = v;
                    _error = null;
                  });
                },
                child: Text(
                  _coversAll ? 'Tout rembourser' : 'Max',
                  style: AppText.l1.copyWith(color: AppColors.primary),
                ),
              ),
            ],
          ),
          if (valid) ...[
            const SizedBox(height: 14),
            _Notice(
              color: isFull ? AppColors.bullish : AppColors.info,
              text:
                  isFull
                      ? 'Prêt soldé · ${fmtAmount(_loan.collateralAsset, _loan.collateralAmount)} débloqués'
                      : 'Reste ${fmtAmount(asset, remaining)} à rembourser',
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            _Notice(color: AppColors.bearish, text: _error!),
          ],
          const SizedBox(height: 16),
          AppButton(
            label:
                valid
                    ? 'Rembourser ${fmtAmount(asset, _amount)}'
                    : 'Rembourser',
            loading: p.isSubmitting,
            onPressed: valid && !p.isSubmitting ? _submit : null,
          ),
        ],
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROLONGATION (aperçu serveur → confirmation)
// ════════════════════════════════════════════════════════════════════════════

class _ExtendSheet extends StatefulWidget {
  final StakeLoan loan;
  const _ExtendSheet({required this.loan});

  @override
  State<_ExtendSheet> createState() => _ExtendSheetState();
}

class _ExtendSheetState extends State<_ExtendSheet> {
  StakeLoanActionResult? _preview;
  bool _loadingPreview = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadPreview());
  }

  Future<void> _loadPreview() async {
    final r = await context.read<StakeLoanProvider>().previewExtension(
      widget.loan.id,
    );
    if (!mounted) return;
    setState(() {
      _preview = r;
      _loadingPreview = false;
      if (r == null) {
        _error = 'Impossible de calculer les frais de prolongation';
      } else if (!r.success) {
        _error = r.error ?? 'Prolongation indisponible';
      }
    });
  }

  Future<void> _confirm() async {
    final provider = context.read<StakeLoanProvider>();
    final nav = Navigator.of(context);
    setState(() => _error = null);
    final result = await provider.extend(widget.loan.id);
    if (!mounted) return;
    if (result != null && result.success) {
      nav.pop(result);
    } else {
      setState(
        () =>
            _error =
                result?.error ??
                provider.errorMessage ??
                'Impossible de prolonger',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<StakeLoanProvider>();
    final pv = _preview;
    final res = (pv != null && pv.success) ? pv : null;

    return _SheetFrame(
      title: 'Prolonger le prêt',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_loadingPreview)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(child: AppLoader(color: AppColors.primary)),
            )
          else if (res != null) ...[
            _SummaryBox(
              children: [
                _SummaryRow(
                  label: 'Frais de prolongation',
                  value:
                      res.feeCharged > 0
                          ? fmtAmount(res.feeAsset, res.feeCharged)
                          : 'Gratuit',
                  strong: true,
                ),
                if (res.newDueAt != null)
                  _SummaryRow(
                    label: 'Nouvelle échéance',
                    value: fmtDate(res.newDueAt!),
                  ),
                _SummaryRow(
                  label: 'Prolongations restantes',
                  value: '${(res.extensionsRemaining - 1).clamp(0, 99)}',
                ),
              ],
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            _Notice(color: AppColors.bearish, text: _error!),
          ],
          const SizedBox(height: 16),
          AppButton(
            label:
                (res != null && res.feeCharged > 0)
                    ? 'Prolonger pour ${fmtAmount(res.feeAsset, res.feeCharged)}'
                    : 'Prolonger',
            loading: p.isSubmitting,
            onPressed: res != null && !p.isSubmitting ? _confirm : null,
          ),
        ],
      ),
    );
  }
}
