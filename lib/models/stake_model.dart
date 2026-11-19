// lib/models/stake_model.dart
// ============================================================================
// STAKING MODELS - Version KISS
// Aligné sur les RPCs : fn_stake, fn_unstake, get_my_staking
// ============================================================================

/// État du staking de l'utilisateur — retourné par get_my_staking()
class StakingState {
  final double staked; // Montant en staking
  final double pendingRewards; // Rewards accumulés (versés à l'unstake)
  final double totalEarned; // Total historique gagné
  final double apr; // APR actuel (ex: 12.0 = 12%)
  final double dailyRate; // Taux journalier % (ex: 0.0329)
  final bool stakingActive; // L'utilisateur a un stake actif
  final DateTime? stakedSince; // Date depuis quand il stake
  final double availableBalance; // Solde disponible WAKATI
  final double locked; // Part bloquée en garantie d'un prêt
  final double unstakable; // Part retirable maintenant (staked - locked)

  const StakingState({
    required this.staked,
    required this.pendingRewards,
    required this.totalEarned,
    required this.apr,
    required this.dailyRate,
    required this.stakingActive,
    this.stakedSince,
    required this.availableBalance,
    this.locked = 0,
    this.unstakable = 0,
  });

  factory StakingState.fromJson(Map<String, dynamic> json) {
    return StakingState(
      staked: _d(json['staked']),
      pendingRewards: _d(json['pending_rewards']),
      totalEarned: _d(json['total_earned']),
      apr: _d(json['apr']),
      dailyRate: _d(json['daily_rate']),
      stakingActive: json['staking_active'] as bool? ?? false,
      stakedSince:
          json['staked_since'] != null
              ? DateTime.tryParse(json['staked_since'] as String)
              : null,
      availableBalance: _d(json['available_balance']),
      locked: _d(json['locked']),
      // Ancienne réponse sans 'unstakable' : tout le stake est retirable.
      unstakable:
          json.containsKey('unstakable')
              ? _d(json['unstakable'])
              : _d(json['staked']),
    );
  }

  factory StakingState.empty() => const StakingState(
    staked: 0,
    pendingRewards: 0,
    totalEarned: 0,
    apr: 0,
    dailyRate: 0,
    stakingActive: false,
    availableBalance: 0,
  );

  /// Reward journalier estimé selon le montant actuellement staké
  double get estimatedDailyReward => staked * dailyRate / 100;

  /// Reward mensuel estimé
  double get estimatedMonthlyReward => estimatedDailyReward * 30;

  /// Reward annuel estimé
  double get estimatedYearlyReward => staked * apr / 100;

  static double _d(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }

  @override
  String toString() =>
      'StakingState(staked=$staked, rewards=$pendingRewards, apr=$apr%)';
}

/// Résultat de fn_stake
class StakeResult {
  final bool success;
  final double staked;
  final double apr;
  final String message;
  final String? error;
  final String? poolId;
  final DateTime? unlockAt;

  const StakeResult({
    required this.success,
    required this.staked,
    required this.apr,
    required this.message,
    this.error,
    this.poolId,
    this.unlockAt,
  });

  factory StakeResult.fromJson(Map<String, dynamic> json) {
    return StakeResult(
      success: json['success'] as bool? ?? false,
      staked: _d(json['staked']),
      apr: _d(json['apr']),
      message: json['message'] as String? ?? '',
      error: json['error'] as String?,
    );
  }

  static double _d(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }
}

/// Résultat de fn_unstake
class UnstakeResult {
  final bool success;
  final double unstaked;
  final double rewardsClaimed;
  final double totalReceived;
  final double penalty; // frais de retrait anticipé (pool bloqué)
  final String message;
  final String? error;

  const UnstakeResult({
    required this.success,
    required this.unstaked,
    required this.rewardsClaimed,
    required this.totalReceived,
    required this.message,
    this.penalty = 0,
    this.error,
  });

  factory UnstakeResult.fromJson(Map<String, dynamic> json) {
    return UnstakeResult(
      success: json['success'] as bool? ?? false,
      unstaked: _d(json['unstaked']),
      rewardsClaimed: _d(json['rewards_claimed']),
      totalReceived: _d(json['total_received']),
      penalty: _d(json['penalty']),
      message: json['message'] as String? ?? '',
      error: json['error'] as String?,
    );
  }

  static double _d(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }
}

/// Exception staking
class StakingException implements Exception {
  final String message;
  final String? code;
  StakingException(this.message, {this.code});

  @override
  String toString() =>
      'StakingException: $message${code != null ? ' ($code)' : ''}';
}
