// lib/models/stake_loan_model.dart
// ============================================================================
// PRÊT SUR STAKING — modèles alignés sur les RPC :
//   fn_get_stake_loan_options / fn_get_my_stake_loans
//   fn_open_stake_loan / fn_repay_loan (→ fn_repay_stake_loan) / fn_extend_stake_loan
// Remplace entièrement loan_model.dart et score_loan_model.dart.
// ============================================================================

double _d(dynamic v) {
  if (v == null) return 0.0;
  if (v is double) return v;
  if (v is int) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0.0;
  return 0.0;
}

int _i(dynamic v) {
  if (v == null) return 0;
  if (v is int) return v;
  if (v is double) return v.toInt();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

DateTime? _dt(dynamic v) {
  if (v == null) return null;
  return DateTime.tryParse(v.toString())?.toLocal();
}

// ============================================================================
// CONDITIONS (config admin : stake_loan_config + lending_collateral_config)
// ============================================================================

class StakeLoanTerms {
  final double maxLtvPct;
  final double liquidationLtvPct;
  final double penaltyPct;
  final int minDurationDays;
  final int maxDurationDays;
  final int defaultDurationDays;
  final int gracePeriodHours;
  final double extensionFeePct;
  final int extensionDays;
  final int maxExtensions;
  final double originationFeePct;

  const StakeLoanTerms({
    required this.maxLtvPct,
    required this.liquidationLtvPct,
    required this.penaltyPct,
    required this.minDurationDays,
    required this.maxDurationDays,
    required this.defaultDurationDays,
    required this.gracePeriodHours,
    required this.extensionFeePct,
    required this.extensionDays,
    required this.maxExtensions,
    required this.originationFeePct,
  });

  factory StakeLoanTerms.fromJson(Map<String, dynamic> json) {
    return StakeLoanTerms(
      maxLtvPct: _d(json['max_ltv_pct']),
      liquidationLtvPct: _d(json['liquidation_ltv_pct']),
      penaltyPct: _d(json['penalty_pct']),
      minDurationDays: _i(json['min_duration_days']),
      maxDurationDays: _i(json['max_duration_days']),
      defaultDurationDays: _i(json['default_duration_days']),
      gracePeriodHours: _i(json['grace_period_hours']),
      extensionFeePct: _d(json['extension_fee_pct']),
      extensionDays: _i(json['extension_days']),
      maxExtensions: _i(json['max_extensions_per_loan']),
      originationFeePct: _d(json['origination_fee_pct']),
    );
  }

  /// Mêmes conditions générales, avec les seuils propres à une garantie.
  StakeLoanTerms withCollateral({
    required double maxLtvPct,
    required double liquidationLtvPct,
    required double penaltyPct,
  }) {
    return StakeLoanTerms(
      maxLtvPct: maxLtvPct,
      liquidationLtvPct: liquidationLtvPct,
      penaltyPct: penaltyPct,
      minDurationDays: minDurationDays,
      maxDurationDays: maxDurationDays,
      defaultDurationDays: defaultDurationDays,
      gracePeriodHours: gracePeriodHours,
      extensionFeePct: extensionFeePct,
      extensionDays: extensionDays,
      maxExtensions: maxExtensions,
      originationFeePct: originationFeePct,
    );
  }

  static const StakeLoanTerms empty = StakeLoanTerms(
    maxLtvPct: 50,
    liquidationLtvPct: 80,
    penaltyPct: 0,
    minDurationDays: 7,
    maxDurationDays: 30,
    defaultDurationDays: 30,
    gracePeriodHours: 48,
    extensionFeePct: 0,
    extensionDays: 15,
    maxExtensions: 0,
    originationFeePct: 0,
  );
}

// ============================================================================
// UN ACTIF EMPRUNTABLE (avec le maximum calculé pour CET utilisateur)
// ============================================================================

class StakeLoanAsset {
  final String symbol;
  final double aprPct;
  final double minBorrow;
  final double maxBorrow; // déjà borné par stake libre, plafonds, trésorerie
  final double priceUsd;

  const StakeLoanAsset({
    required this.symbol,
    required this.aprPct,
    required this.minBorrow,
    required this.maxBorrow,
    required this.priceUsd,
  });

  factory StakeLoanAsset.fromJson(Map<String, dynamic> json) {
    return StakeLoanAsset(
      symbol: json['asset_symbol'] as String? ?? '',
      aprPct: _d(json['apr_rate_pct']),
      minBorrow: _d(json['min_borrow_amount']),
      maxBorrow: _d(json['max_borrow_amount']),
      priceUsd: _d(json['price_usd']),
    );
  }

  /// Empruntable maintenant : le maximum couvre au moins le minimum exigé.
  bool get isAvailable => maxBorrow > 0 && maxBorrow >= minBorrow;
}

// ============================================================================
// OPTIONS D'EMPRUNT (fn_get_stake_loan_options)
// ============================================================================

/// Un actif stakeé utilisable comme garantie, avec ses seuils et ce qu'il
/// permet d'emprunter (fn_get_stake_loan_options → collaterals[]).
class StakeLoanCollateral {
  final String symbol;
  final String poolName;
  final double stakeAmount;
  final double stakeLocked;
  final double stakeFree;
  final double priceUsd;
  final double maxLtvPct;
  final double liquidationLtvPct;
  final double penaltyPct;
  final List<StakeLoanAsset> assets;

  const StakeLoanCollateral({
    required this.symbol,
    required this.poolName,
    required this.stakeAmount,
    required this.stakeLocked,
    required this.stakeFree,
    required this.priceUsd,
    required this.maxLtvPct,
    required this.liquidationLtvPct,
    required this.penaltyPct,
    required this.assets,
  });

  factory StakeLoanCollateral.fromJson(Map<String, dynamic> json) {
    return StakeLoanCollateral(
      symbol: json['asset_symbol'] as String? ?? '',
      poolName: json['pool_name'] as String? ?? '',
      stakeAmount: _d(json['stake_amount']),
      stakeLocked: _d(json['locked_amount']),
      stakeFree: _d(json['free_amount']),
      priceUsd: _d(json['price_usd']),
      maxLtvPct: _d(json['max_ltv_pct']),
      liquidationLtvPct: _d(json['liquidation_ltv_pct']),
      penaltyPct: _d(json['penalty_pct']),
      assets:
          ((json['assets'] as List?) ?? const [])
              .map(
                (a) => StakeLoanAsset.fromJson(
                  Map<String, dynamic>.from(a as Map),
                ),
              )
              .toList(),
    );
  }

  double get freeValueUsd => stakeFree * priceUsd;
}

class StakeLoanOptions {
  final bool enabled;
  final String collateralSymbol; // garantie à laquelle se rapportent les champs
  final double stakeAmount;
  final double stakeLocked;
  final double stakeFree;
  final double collateralPriceUsd;
  final StakeLoanTerms terms;
  final List<StakeLoanAsset> assets;
  final List<StakeLoanCollateral> collaterals; // toutes les garanties possibles

  const StakeLoanOptions({
    required this.enabled,
    this.collateralSymbol = 'WAKATI',
    required this.stakeAmount,
    required this.stakeLocked,
    required this.stakeFree,
    required this.collateralPriceUsd,
    required this.terms,
    required this.assets,
    this.collaterals = const [],
  });

  factory StakeLoanOptions.fromJson(Map<String, dynamic> json) {
    final stake = Map<String, dynamic>.from((json['stake'] as Map?) ?? {});
    final terms = Map<String, dynamic>.from((json['terms'] as Map?) ?? {});
    final assets =
        ((json['assets'] as List?) ?? const [])
            .map(
              (a) =>
                  StakeLoanAsset.fromJson(Map<String, dynamic>.from(a as Map)),
            )
            .toList();
    final baseTerms =
        terms.isEmpty ? StakeLoanTerms.empty : StakeLoanTerms.fromJson(terms);

    var collaterals =
        ((json['collaterals'] as List?) ?? const [])
            .map(
              (c) => StakeLoanCollateral.fromJson(
                Map<String, dynamic>.from(c as Map),
              ),
            )
            .toList();

    // Serveur sans "collaterals" (ancienne version) : on reconstitue la
    // garantie WAKATI à partir des clés historiques.
    if (collaterals.isEmpty && _d(stake['free_amount']) > 0) {
      collaterals = [
        StakeLoanCollateral(
          symbol: 'WAKATI',
          poolName: '',
          stakeAmount: _d(stake['amount']),
          stakeLocked: _d(stake['locked_amount']),
          stakeFree: _d(stake['free_amount']),
          priceUsd: _d(stake['wakati_price_usd']),
          maxLtvPct: baseTerms.maxLtvPct,
          liquidationLtvPct: baseTerms.liquidationLtvPct,
          penaltyPct: baseTerms.penaltyPct,
          assets: assets,
        ),
      ];
    }

    return StakeLoanOptions(
      enabled: json['enabled'] as bool? ?? false,
      stakeAmount: _d(stake['amount']),
      stakeLocked: _d(stake['locked_amount']),
      stakeFree: _d(stake['free_amount']),
      collateralPriceUsd: _d(stake['wakati_price_usd']),
      terms: baseTerms,
      assets: assets,
      collaterals: collaterals,
    );
  }

  /// Vue des options pour une garantie donnée : stake libre, prix, seuils de
  /// LTV et actifs empruntables deviennent ceux de cet actif. Les écrans
  /// n'ont ainsi qu'à lire `options.*` sans connaître la garantie choisie.
  StakeLoanOptions forCollateral(String symbol) {
    for (final c in collaterals) {
      if (c.symbol == symbol) {
        return StakeLoanOptions(
          enabled: enabled,
          collateralSymbol: c.symbol,
          stakeAmount: c.stakeAmount,
          stakeLocked: c.stakeLocked,
          stakeFree: c.stakeFree,
          collateralPriceUsd: c.priceUsd,
          terms: terms.withCollateral(
            maxLtvPct: c.maxLtvPct,
            liquidationLtvPct: c.liquidationLtvPct,
            penaltyPct: c.penaltyPct,
          ),
          assets: c.assets,
          collaterals: collaterals,
        );
      }
    }
    return this; // aucune position sur cet actif : vue WAKATI historique
  }

  factory StakeLoanOptions.empty() => const StakeLoanOptions(
    enabled: false,
    stakeAmount: 0,
    stakeLocked: 0,
    stakeFree: 0,
    collateralPriceUsd: 0,
    terms: StakeLoanTerms.empty,
    assets: [],
  );

  double get stakeFreeValueUsd => stakeFree * collateralPriceUsd;
  bool get hasStake => stakeAmount > 0;
  List<StakeLoanAsset> get availableAssets =>
      assets.where((a) => a.isAvailable).toList();

  StakeLoanAsset? assetBySymbol(String symbol) {
    for (final a in assets) {
      if (a.symbol == symbol) return a;
    }
    return null;
  }

  /// Garantie à bloquer pour emprunter [amount] de [asset], au LTV max.
  /// Estimation côté client ; le serveur recalcule et arrondit au 1e-8 supérieur.
  double collateralFor(double amount, StakeLoanAsset asset) {
    if (collateralPriceUsd <= 0 || asset.priceUsd <= 0 || terms.maxLtvPct <= 0) {
      return 0;
    }
    return amount * asset.priceUsd / (terms.maxLtvPct / 100) / collateralPriceUsd;
  }
}

// ============================================================================
// PRÊT ACTIF (fn_get_my_stake_loans → active[])
// ============================================================================

enum StakeLoanPhase { running, grace, overdue }

enum StakeLoanRisk { safe, warning, critical }

class StakeLoan {
  final String id;
  final StakeLoanPhase phase;
  final String borrowAsset;
  final double principal;
  final double debt; // dette en direct, intérêts inclus
  final double interest;
  final double aprPct;
  final String collateralAsset;
  final double collateralAmount;
  final double collateralValueUsd;
  final double debtUsd;
  final double ltvPct;
  final double liquidationLtvPct;
  final DateTime? openedAt;
  final DateTime? dueAt;
  final DateTime? graceUntil;
  final int durationDays;
  final double originationFee;
  final int extensionsUsed;
  final int extensionsMax;
  final double extensionFee;
  final int extensionDays;
  final bool canExtend;

  const StakeLoan({
    required this.id,
    required this.phase,
    required this.borrowAsset,
    required this.principal,
    required this.debt,
    required this.interest,
    required this.aprPct,
    this.collateralAsset = 'WAKATI',
    required this.collateralAmount,
    required this.collateralValueUsd,
    required this.debtUsd,
    required this.ltvPct,
    required this.liquidationLtvPct,
    this.openedAt,
    this.dueAt,
    this.graceUntil,
    required this.durationDays,
    required this.originationFee,
    required this.extensionsUsed,
    required this.extensionsMax,
    required this.extensionFee,
    required this.extensionDays,
    required this.canExtend,
  });

  factory StakeLoan.fromJson(Map<String, dynamic> json) {
    final phaseRaw = json['phase'] as String? ?? 'running';
    return StakeLoan(
      id: json['id'] as String? ?? '',
      phase:
          phaseRaw == 'grace'
              ? StakeLoanPhase.grace
              : phaseRaw == 'overdue'
              ? StakeLoanPhase.overdue
              : StakeLoanPhase.running,
      borrowAsset: json['borrow_asset'] as String? ?? '',
      principal: _d(json['principal']),
      debt: _d(json['debt']),
      interest: _d(json['interest']),
      aprPct: _d(json['apr_rate_pct']),
      collateralAsset: json['collateral_asset'] as String? ?? 'WAKATI',
      collateralAmount: _d(json['collateral_amount']),
      collateralValueUsd: _d(json['collateral_value_usd']),
      debtUsd: _d(json['debt_usd']),
      ltvPct: _d(json['ltv_pct']),
      liquidationLtvPct: _d(json['liquidation_ltv_pct']),
      openedAt: _dt(json['opened_at']),
      dueAt: _dt(json['due_at']),
      graceUntil: _dt(json['grace_until']),
      durationDays: _i(json['duration_days']),
      originationFee: _d(json['origination_fee']),
      extensionsUsed: _i(json['extensions_used']),
      extensionsMax: _i(json['extensions_max']),
      extensionFee: _d(json['extension_fee']),
      extensionDays: _i(json['extension_days']),
      canExtend: json['can_extend'] as bool? ?? false,
    );
  }

  /// Points de LTV restants avant la saisie automatique.
  double get marginPts => liquidationLtvPct - ltvPct;

  /// 0..1 : part de la marge consommée (1 = seuil de saisie atteint).
  double get healthUsed =>
      liquidationLtvPct <= 0 ? 0 : (ltvPct / liquidationLtvPct).clamp(0.0, 1.0);

  Duration? get timeToDue => dueAt?.difference(DateTime.now());
  Duration? get timeToSeizure => graceUntil?.difference(DateTime.now());

  StakeLoanRisk get risk {
    if (phase != StakeLoanPhase.running || marginPts <= 5) {
      return StakeLoanRisk.critical;
    }
    final t = timeToDue;
    if (marginPts <= 12 || (t != null && t.inHours < 24)) {
      return StakeLoanRisk.warning;
    }
    return StakeLoanRisk.safe;
  }

  /// Mérite une alerte visible (badge dans la barre de navigation).
  bool get needsAttention => risk != StakeLoanRisk.safe;
}

// ============================================================================
// HISTORIQUE (fn_get_my_stake_loans → history[])
// ============================================================================

class StakeLoanRecord {
  final String id;
  final String status; // repaid | liquidated
  final String borrowAsset;
  final double principal;
  final String collateralAsset;
  final double collateralAmount;
  final DateTime? openedAt;
  final DateTime? closedAt;
  final String? liquidationReason; // overdue | ltv
  final double originationFee;
  final int durationDays;
  final double seized;

  const StakeLoanRecord({
    required this.id,
    required this.status,
    required this.borrowAsset,
    required this.principal,
    this.collateralAsset = 'WAKATI',
    required this.collateralAmount,
    this.openedAt,
    this.closedAt,
    this.liquidationReason,
    required this.originationFee,
    required this.durationDays,
    required this.seized,
  });

  factory StakeLoanRecord.fromJson(Map<String, dynamic> json) {
    return StakeLoanRecord(
      id: json['id'] as String? ?? '',
      status: json['status'] as String? ?? '',
      borrowAsset: json['borrow_asset'] as String? ?? '',
      principal: _d(json['principal']),
      collateralAsset: json['collateral_asset'] as String? ?? 'WAKATI',
      collateralAmount: _d(json['collateral_amount']),
      openedAt: _dt(json['opened_at']),
      closedAt: _dt(json['closed_at']),
      liquidationReason: json['liquidation_reason'] as String?,
      originationFee: _d(json['origination_fee']),
      durationDays: _i(json['duration_days']),
      seized: _d(json['seized']),
    );
  }

  bool get isRepaid => status == 'repaid';
  bool get isSeized => status == 'liquidated';
}

class MyStakeLoans {
  final List<StakeLoan> active;
  final List<StakeLoanRecord> history;
  const MyStakeLoans({required this.active, required this.history});
}

// ============================================================================
// RÉSULTAT D'UNE ACTION (open / repay / extend)
// ============================================================================

class StakeLoanActionResult {
  final bool success;
  final String? error;
  final Map<String, dynamic> raw;

  const StakeLoanActionResult({
    required this.success,
    this.error,
    required this.raw,
  });

  factory StakeLoanActionResult.fromJson(Map<String, dynamic> json) {
    return StakeLoanActionResult(
      success: json['success'] as bool? ?? false,
      error: json['error'] as String?,
      raw: json,
    );
  }

  double get borrowed => _d(raw['borrowed']);
  double get originationFee => _d(raw['origination_fee']);
  double get netReceived => _d(raw['net_received']);
  double get collateralLocked => _d(raw['collateral_locked']);
  String get collateralAsset => raw['collateral_asset'] as String? ?? 'WAKATI';
  double get ltvPct => _d(raw['ltv_pct']);
  DateTime? get dueAt => _dt(raw['due_at']);
  DateTime? get graceUntil => _dt(raw['grace_until']);

  double get repaid => _d(raw['repaid']);
  bool get fullyRepaid => raw['fully_repaid'] as bool? ?? false;
  double get collateralReleased => _d(raw['collateral_released']);

  bool get isPreview => raw['preview'] as bool? ?? false;
  double get feeCharged => _d(raw['fee_charged']);
  String get feeAsset => raw['fee_asset'] as String? ?? '';
  DateTime? get newDueAt => _dt(raw['new_due_at']);
  DateTime? get newGraceUntil => _dt(raw['new_grace_until']);
  int get extensionsRemaining => _i(raw['extensions_remaining']);
}

class StakeLoanException implements Exception {
  final String message;
  final String? errorCode;
  StakeLoanException(this.message, {this.errorCode});

  @override
  String toString() => message;
}
