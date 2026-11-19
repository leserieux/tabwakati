// lib/providers/staking_provider.dart
// ============================================================================
// STAKING PROVIDER - Multi-pools
// État pools : liste des pools actifs + ma position dans chacun
// État WAKATI : StakingState (staked, rewards, apr) — utilisé par le wallet
//               et les prêts adossés au staking
// Actions : stake(amount, poolId) / unstake(amount, poolId)
// ============================================================================

import 'package:flutter/material.dart';
import 'package:wakati/service/staking/staking_service.dart';
import '../../models/stake_model.dart';
import '../../models/staking_pool_model.dart';

class StakingProvider extends ChangeNotifier {
  final StakingService _service = StakingService();

  // ─── État ───
  StakingState _state = StakingState.empty();
  bool _isLoading = false;
  bool _isActing = false; // stake ou unstake en cours
  String? _error;

  // ─── Pools ───
  List<StakingPoolModel> _pools = [];
  bool _isLoadingPools = false;

  // ─── Getters ───
  List<StakingPoolModel> get pools => _pools;
  bool get isLoadingPools => _isLoadingPools;

  /// Pools dans lesquels l'utilisateur a une position
  List<StakingPoolModel> get myPositions =>
      _pools.where((p) => p.userHasStake == true).toList();

  StakingPoolModel? poolById(String id) {
    for (final p in _pools) {
      if (p.id == id) return p;
    }
    return null;
  }

  StakingState get state => _state;
  bool get isLoading => _isLoading;
  bool get isActing => _isActing;
  String? get error => _error;

  // Raccourcis pratiques
  double get staked => _state.staked;
  double get locked => _state.locked;
  double get unstakable => _state.unstakable;
  double get pendingRewards => _state.pendingRewards;
  double get totalEarned => _state.totalEarned;
  double get apr => _state.apr;
  double get dailyRate => _state.dailyRate;
  bool get isStaking => _state.stakingActive;
  double get available => _state.availableBalance;

  double get estimatedDailyReward => _state.estimatedDailyReward;
  double get estimatedMonthlyReward => _state.estimatedMonthlyReward;

  // ─────────────────────────────────────────────
  // INITIALISATION
  // ─────────────────────────────────────────────

  Future<void> initialize() =>
      Future.wait([loadState(), loadPools()]).then((_) {});

  Future<void> loadState({bool forceRefresh = false}) async {
    _setLoading(true);
    _clearError();

    try {
      _state = await _service.getMyStaking(forceRefresh: forceRefresh);
    } catch (e) {
      _error = _friendlyError(e);
    } finally {
      _setLoading(false);
    }
  }

  Future<void> refreshAll() => Future.wait([
    loadState(forceRefresh: true),
    loadPools(forceRefresh: true),
  ]).then((_) {});

  /// Charge tous les pools actifs avec la position de l'utilisateur.
  /// Le spinner ne s'affiche qu'au premier chargement (liste vide).
  Future<void> loadPools({bool forceRefresh = false}) async {
    if (_pools.isEmpty) {
      _isLoadingPools = true;
      notifyListeners();
    }
    try {
      _pools = await _service.getPools(forceRefresh: forceRefresh);
    } catch (e) {
      _error = _friendlyError(e);
    } finally {
      _isLoadingPools = false;
      notifyListeners();
    }
  }

  // ─────────────────────────────────────────────
  // STAKER
  // ─────────────────────────────────────────────

  /// Retourne le StakeResult ou null en cas d'erreur (l'erreur est dans [error])
  Future<StakeResult?> stake(double amount, {String? poolId}) async {
    if (amount <= 0) {
      _error = 'Montant invalide';
      notifyListeners();
      return null;
    }

    _setActing(true);
    _clearError();

    try {
      final result = await _service.stake(amount, poolId: poolId);
      // Recharger l'état depuis la DB (résumé WAKATI + pools)
      await refreshAll();
      return result;
    } catch (e) {
      _error = _friendlyError(e);
      notifyListeners();
      return null;
    } finally {
      _setActing(false);
    }
  }

  // ─────────────────────────────────────────────
  // UNSTAKER
  // ─────────────────────────────────────────────

  /// Retourne le UnstakeResult ou null en cas d'erreur
  Future<UnstakeResult?> unstake(double amount, {String? poolId}) async {
    if (amount <= 0) {
      _error = 'Montant invalide';
      notifyListeners();
      return null;
    }

    _setActing(true);
    _clearError();

    try {
      final result = await _service.unstake(amount, poolId: poolId);
      await refreshAll();
      return result;
    } catch (e) {
      _error = _friendlyError(e);
      notifyListeners();
      return null;
    } finally {
      _setActing(false);
    }
  }

  // ─────────────────────────────────────────────
  // UTILITAIRES
  // ─────────────────────────────────────────────

  void clearError() {
    _error = null;
    notifyListeners();
  }

  void _setLoading(bool v) {
    _isLoading = v;
    notifyListeners();
  }

  void _setActing(bool v) {
    _isActing = v;
    notifyListeners();
  }

  void _clearError() => _error = null;

  String _friendlyError(dynamic e) {
    if (e is StakingException) return e.message;
    final msg = e.toString().toLowerCase();
    if (msg.contains('solde insuffisant') || msg.contains('insufficient')) {
      return 'Solde insuffisant';
    }
    if (msg.contains('auth') || msg.contains('non authentifié')) {
      return 'Session expirée, reconnectez-vous';
    }
    if (msg.contains('timeout') || msg.contains('connection')) {
      return 'Problème de connexion, réessayez';
    }
    return 'Une erreur est survenue, réessayez';
  }

  @override
  void dispose() {
    super.dispose();
  }
}
