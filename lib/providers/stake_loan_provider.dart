// lib/providers/stake_loan_provider.dart
import 'package:flutter/material.dart';
import 'package:wakati/service/core/error_handler.dart';
import 'package:wakati/service/lending/stake_loan_service.dart';
import 'package:wakati/models/stake_loan_model.dart';

class StakeLoanProvider extends ChangeNotifier {
  final StakeLoanService _service = StakeLoanService();
  final ErrorHandler _errorHandler = ErrorHandler();

  bool _isLoading = false;
  bool _hasLoaded = false;
  bool _isSubmitting = false;
  String? _errorMessage;

  StakeLoanOptions _rawOptions = StakeLoanOptions.empty();
  String _selectedCollateral = 'WAKATI';
  List<StakeLoan> _active = [];
  List<StakeLoanRecord> _history = [];

  bool get isLoading => _isLoading;
  bool get hasLoaded => _hasLoaded;
  bool get isSubmitting => _isSubmitting;
  String? get errorMessage => _errorMessage;

  /// Options pour la garantie sélectionnée (stake libre, LTV, actifs
  /// empruntables, prix) : les écrans les lisent sans autre logique.
  StakeLoanOptions get options =>
      _rawOptions.forCollateral(_selectedCollateral);
  List<StakeLoanCollateral> get collaterals => _rawOptions.collaterals;
  String get selectedCollateral => _selectedCollateral;

  void selectCollateral(String symbol) {
    if (symbol == _selectedCollateral) return;
    _selectedCollateral = symbol;
    notifyListeners();
  }

  /// Garde une garantie valide : conserve le choix s'il existe encore, sinon
  /// WAKATI, sinon l'actif avec le plus de valeur libre.
  void _ensureCollateralSelection() {
    final list = _rawOptions.collaterals;
    if (list.isEmpty || list.any((c) => c.symbol == _selectedCollateral)) {
      return;
    }
    final wakati = list.where((c) => c.symbol == 'WAKATI');
    if (wakati.isNotEmpty) {
      _selectedCollateral = 'WAKATI';
      return;
    }
    final best = [...list]..sort((a, b) => b.freeValueUsd.compareTo(a.freeValueUsd));
    _selectedCollateral = best.first.symbol;
  }
  List<StakeLoan> get activeLoans => _active;
  List<StakeLoanRecord> get history => _history;
  bool get hasActiveLoans => _active.isNotEmpty;

  /// Prêts à surveiller : délai de grâce, marge faible ou échéance < 24 h.
  /// Alimente le badge rouge de la barre de navigation.
  List<StakeLoan> get atRiskLoans =>
      _active.where((l) => l.needsAttention).toList();

  // ══════════════════════════════════════════════════════════════
  // CHARGEMENT
  // ══════════════════════════════════════════════════════════════

  Future<void> initialize() => refreshAll();

  Future<void> refreshAll() async {
    _setLoading(true);
    try {
      final results = await Future.wait([
        _service.getOptions(),
        _service.getMyLoans(),
      ]);
      _rawOptions = results[0] as StakeLoanOptions;
      _ensureCollateralSelection();
      final mine = results[1] as MyStakeLoans;
      _active = mine.active;
      _history = mine.history;
      _errorMessage = null;
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanProvider.refreshAll');
      _errorMessage = 'Impossible de charger tes prêts';
    } finally {
      _hasLoaded = true;
      _setLoading(false);
    }
  }

  /// Rafraîchissement léger (LTV, échéances) sans spinner plein écran.
  Future<void> loadMyLoans() async {
    try {
      final mine = await _service.getMyLoans();
      _active = mine.active;
      _history = mine.history;
      notifyListeners();
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanProvider.loadMyLoans');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ACTIONS (retournent le résultat brut pour que l'écran affiche le détail)
  // ══════════════════════════════════════════════════════════════

  Future<StakeLoanActionResult?> openLoan({
    required String borrowAsset,
    required double amount,
    required int durationDays,
  }) {
    return _run('openLoan', "Erreur lors de l'ouverture du prêt", () async {
      return _service.openLoan(
        borrowAsset: borrowAsset,
        amount: amount,
        durationDays: durationDays,
        collateralAsset: _selectedCollateral,
      );
    });
  }

  Future<StakeLoanActionResult?> repay({
    required String loanId,
    required double amount,
  }) {
    return _run('repay', 'Erreur lors du remboursement', () async {
      return _service.repay(loanId: loanId, amount: amount);
    });
  }

  /// Aperçu : pas de changement d'état, pas de rechargement.
  Future<StakeLoanActionResult?> previewExtension(String loanId) async {
    try {
      return await _service.extend(loanId: loanId, preview: true);
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanProvider.previewExtension');
      return null;
    }
  }

  Future<StakeLoanActionResult?> extend(String loanId) {
    return _run('extend', 'Erreur lors de la prolongation', () async {
      return _service.extend(loanId: loanId);
    });
  }

  Future<StakeLoanActionResult?> _run(
    String name,
    String fallbackError,
    Future<StakeLoanActionResult> Function() action,
  ) async {
    _setSubmitting(true);
    _errorMessage = null;
    try {
      final result = await action();
      if (!result.success) {
        _errorMessage = result.error ?? fallbackError;
      } else {
        await refreshAll();
      }
      notifyListeners();
      return result;
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanProvider.$name');
      _errorMessage = fallbackError;
      notifyListeners();
      return null;
    } finally {
      _setSubmitting(false);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // UTILITAIRES
  // ══════════════════════════════════════════════════════════════

  void _setLoading(bool v) {
    _isLoading = v;
    notifyListeners();
  }

  void _setSubmitting(bool v) {
    _isSubmitting = v;
    notifyListeners();
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }
}
