// lib/screens/staking/staking_screen.dart
// ============================================================================
// STAKING — design épuré façon exchange
//   1. StakingScreen     : liste des pools (recherche, filtres, tri APY)
//   2. _SubscribeScreen  : produit, montant, Résumé / Règles, Confirmer
//   3. _MyAssetsScreen   : mes positions
//   4. _RedeemScreen     : retrait
// ============================================================================

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../providers/staking_provider.dart';
import '../../providers/balance_provider.dart';
import '../../models/staking_pool_model.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/screens/home/widgets/asset_icon.dart';

// ============================================================================
// 1. LISTE
// ============================================================================

enum _Filter { all, flexible, locked }

class StakingScreen extends StatefulWidget {
  const StakingScreen({super.key});

  @override
  State<StakingScreen> createState() => _StakingScreenState();
}

class _StakingScreenState extends State<StakingScreen> {
  String _query = '';
  _Filter _filter = _Filter.all;
  int _sort = 0; // 0 = serveur, 1 = APY décroissant, 2 = croissant

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<StakingProvider>().initialize();
    });
  }

  List<StakingPoolModel> _visible(List<StakingPoolModel> pools) {
    final q = _query.trim().toLowerCase();
    final list =
        pools.where((p) {
          if (_filter == _Filter.flexible && !p.hasNoLock) return false;
          if (_filter == _Filter.locked && p.hasNoLock) return false;
          if (q.isEmpty) return true;
          return p.assetSymbol.toLowerCase().contains(q) ||
              p.name.toLowerCase().contains(q);
        }).toList();
    if (_sort == 1) list.sort((a, b) => b.totalApy.compareTo(a.totalApy));
    if (_sort == 2) list.sort((a, b) => a.totalApy.compareTo(b.totalApy));
    return list;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: AppBar(
        backgroundColor: context.bgColor,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      body: Consumer<StakingProvider>(
        builder: (context, provider, _) {
          if (provider.isLoadingPools && provider.pools.isEmpty) {
            return const Center(
              child: CircularProgressIndicator(
                color: AppColors.primary,
                strokeWidth: 2,
              ),
            );
          }

          final pools = _visible(provider.pools);
          final positions = provider.myPositions;

          return RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: context.surfaceHighColor,
            onRefresh: provider.refreshAll,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
              children: [
                Text(
                  'Staking',
                  style: TextStyle(
                    color: context.textPrimary,
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 16),
                if (positions.isNotEmpty) ...[
                  _MyAssetsCard(
                    positions: positions,
                    onTap: () => _push(context, const _MyAssetsScreen()),
                  ),
                  const SizedBox(height: 12),
                ],
                _SearchField(onChanged: (v) => setState(() => _query = v)),
                const SizedBox(height: 8),
                _FilterBar(
                  filter: _filter,
                  sort: _sort,
                  onFilter: (f) => setState(() => _filter = f),
                  onSort: () => setState(() => _sort = (_sort + 1) % 3),
                ),
                const SizedBox(height: 8),
                if (provider.error != null) ...[
                  _ErrorBanner(
                    message: provider.error!,
                    onDismiss: provider.clearError,
                  ),
                  const SizedBox(height: 12),
                ],
                if (pools.isEmpty)
                  _EmptyState(
                    icon: Icons.search_off_rounded,
                    text:
                        provider.pools.isEmpty
                            ? 'Aucun produit disponible'
                            : 'Aucun résultat',
                    actionLabel: provider.pools.isEmpty ? 'Actualiser' : null,
                    onAction: provider.refreshAll,
                  ),
                for (final p in pools)
                  _PoolCard(
                    pool: p,
                    onTap:
                        () => _push(
                          context,
                          _SubscribeScreen(
                            symbol: p.assetSymbol,
                            initialPoolId: p.id,
                          ),
                        ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Raccourci vers mes positions : pastilles d'actifs + chevron
class _MyAssetsCard extends StatelessWidget {
  final List<StakingPoolModel> positions;
  final VoidCallback onTap;
  const _MyAssetsCard({required this.positions, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final shown = positions.take(3).toList();
    return Material(
      color: context.surfaceColor,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          height: 56,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: context.borderColor),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 28.0 + (shown.length - 1) * 18,
                height: 28,
                child: Stack(
                  children: [
                    for (var i = 0; i < shown.length; i++)
                      Positioned(
                        left: i * 18.0,
                        child: Container(
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: context.surfaceColor,
                              width: 2,
                            ),
                          ),
                          child: AssetIcon(
                            symbol: shown[i].assetSymbol,
                            size: 24,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  'Mes actifs',
                  style: TextStyle(
                    color: context.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                '${positions.length}',
                style: TextStyle(color: context.textSecondary, fontSize: 14),
              ),
              Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: context.textDisabled,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  final ValueChanged<String> onChanged;
  const _SearchField({required this.onChanged});

  @override
  Widget build(BuildContext context) {
    OutlineInputBorder none() => OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide.none,
    );
    return TextField(
      onChanged: onChanged,
      style: TextStyle(color: context.textPrimary, fontSize: 15),
      decoration: InputDecoration(
        isDense: true,
        filled: true,
        fillColor: context.surfaceColor,
        hintText: 'Rechercher',
        hintStyle: TextStyle(color: context.textDisabled, fontSize: 15),
        prefixIcon: Icon(
          Icons.search_rounded,
          color: context.textDisabled,
          size: 20,
        ),
        contentPadding: const EdgeInsets.symmetric(vertical: 13),
        border: none(),
        enabledBorder: none(),
        focusedBorder: none(),
      ),
    );
  }
}

class _FilterBar extends StatelessWidget {
  final _Filter filter;
  final int sort;
  final ValueChanged<_Filter> onFilter;
  final VoidCallback onSort;
  const _FilterBar({
    required this.filter,
    required this.sort,
    required this.onFilter,
    required this.onSort,
  });

  Widget _tab(BuildContext context, String label, _Filter f) {
    final selected = filter == f;
    return GestureDetector(
      onTap: () => onFilter(f),
      behavior: HitTestBehavior.opaque,
      child: Container(
        margin: const EdgeInsets.only(right: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? context.surfaceHighColor : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? context.textPrimary : context.textSecondary,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sortIcon =
        sort == 1
            ? Icons.arrow_downward_rounded
            : sort == 2
            ? Icons.arrow_upward_rounded
            : Icons.unfold_more_rounded;
    return Row(
      children: [
        _tab(context, 'Tous', _Filter.all),
        _tab(context, 'Flexible', _Filter.flexible),
        _tab(context, 'Bloqué', _Filter.locked),
        const Spacer(),
        GestureDetector(
          onTap: onSort,
          behavior: HitTestBehavior.opaque,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Text(
                  'APY',
                  style: TextStyle(color: context.textSecondary, fontSize: 13),
                ),
                const SizedBox(width: 2),
                Icon(sortIcon, size: 16, color: context.textSecondary),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _PoolCard extends StatelessWidget {
  final StakingPoolModel pool;
  final VoidCallback onTap;
  const _PoolCard({required this.pool, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: context.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: context.borderColor),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    AssetIcon(symbol: pool.assetSymbol, size: 40),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            pool.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: context.textPrimary,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            children: [
                              _lockChip(context, pool),
                              if (pool.userHasStake == true)
                                const _Chip(
                                  label: 'Staké',
                                  color: AppColors.primary,
                                ),
                              if (!pool.canStake)
                                const _Chip(
                                  label: 'Complet',
                                  color: AppColors.bearish,
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          _fmtApy(pool.totalApy),
                          style: TextStyle(
                            color: _green(context),
                            fontSize: 20,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          'APY',
                          style: TextStyle(
                            color: context.textSecondary,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                if (pool.maxPoolCapacity != null) ...[
                  const SizedBox(height: 12),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: (pool.capacityFillPercent / 100).clamp(0.0, 1.0),
                      minHeight: 3,
                      backgroundColor: context.borderColor,
                      color:
                          pool.capacityFillPercent >= 90
                              ? AppColors.bearish
                              : AppColors.primary,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ============================================================================
// 2. SOUSCRIPTION
// ============================================================================

class _SubscribeScreen extends StatefulWidget {
  final String symbol;
  final String? initialPoolId;
  const _SubscribeScreen({required this.symbol, this.initialPoolId});

  @override
  State<_SubscribeScreen> createState() => _SubscribeScreenState();
}

class _SubscribeScreenState extends State<_SubscribeScreen> {
  final _ctrl = TextEditingController();
  String? _poolId;
  double _amount = 0;
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    _poolId = widget.initialPoolId;
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  List<StakingPoolModel> _products(StakingProvider provider) {
    final list =
        provider.pools.where((p) => p.assetSymbol == widget.symbol).toList();
    list.sort((a, b) {
      final byLock = a.lockPeriodDays.compareTo(b.lockPeriodDays);
      return byLock != 0 ? byLock : b.totalApy.compareTo(a.totalApy);
    });
    return list;
  }

  double? _capacityLeft(StakingPoolModel pool) {
    if (pool.maxPoolCapacity == null) return null;
    return (pool.maxPoolCapacity! - pool.totalStaked).clamp(
      0.0,
      double.infinity,
    );
  }

  /// Marge restante sous le plafond par utilisateur (position déjà détenue
  /// incluse). null = pas de plafond.
  double? _userAllowance(StakingPoolModel pool) {
    if (pool.maxStakeAmount == null) return null;
    return (pool.maxStakeAmount! - (pool.userStakedAmount ?? 0)).clamp(
      0.0,
      double.infinity,
    );
  }

  double _maxAmount(StakingPoolModel pool, double available) {
    var m = available;
    final allowance = _userAllowance(pool);
    if (allowance != null && allowance < m) m = allowance;
    final left = _capacityLeft(pool);
    if (left != null && left < m) m = left;
    return m;
  }

  String? _validation(StakingPoolModel pool, double available) {
    if (_amount <= 0) return null;
    if (_amount > available) return 'Solde insuffisant';
    if (_amount < pool.minStakeAmount) {
      return 'Minimum ${_fmtAmt(pool.minStakeAmount)} ${pool.assetSymbol}';
    }
    final allowance = _userAllowance(pool);
    if (allowance != null && _amount > allowance) {
      return allowance <= 0
          ? 'Plafond atteint (${_fmtAmt(pool.maxStakeAmount!)} ${pool.assetSymbol})'
          : 'Maximum ${_fmtAmt(allowance)} ${pool.assetSymbol}';
    }
    final left = _capacityLeft(pool);
    if (left != null && _amount > left) return 'Capacité du pool dépassée';
    return null;
  }

  Future<void> _confirm(StakingProvider provider, StakingPoolModel pool) async {
    final amount = _amount;
    final messenger = ScaffoldMessenger.of(context);
    final result = await provider.stake(amount, poolId: pool.id);
    if (result != null && result.success) {
      _snack(messenger, '${_fmtAmt(amount)} ${pool.assetSymbol} stakés');
      if (mounted) Navigator.pop(context);
    } else {
      _snack(messenger, result?.error ?? provider.error ?? 'Échec du staking');
      provider.clearError();
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<StakingProvider>();
    final products = _products(provider);

    if (products.isEmpty) {
      return Scaffold(
        backgroundColor: context.bgColor,
        appBar: _appBar(context, widget.symbol, widget.symbol),
        body: const _EmptyState(
          icon: Icons.inventory_2_outlined,
          text: 'Produit indisponible',
        ),
      );
    }

    final pool = products.firstWhere(
      (p) => p.id == _poolId,
      orElse: () => products.first,
    );
    final available =
        context.watch<BalanceProvider>().availableBalances[pool.assetSymbol] ??
        0.0;
    final error = _validation(pool, available);
    final canSubmit =
        _amount > 0 && error == null && pool.canStake && !provider.isActing;
    final daily = _amount * pool.totalApy / 100 / 365;

    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: _appBar(context, widget.symbol, widget.symbol),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    height: 76,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: products.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 10),
                      itemBuilder: (_, i) {
                        final p = products[i];
                        return _ProductCard(
                          pool: p,
                          selected: p.id == pool.id,
                          onTap:
                              () => setState(() {
                                _poolId = p.id;
                                _ctrl.clear();
                                _amount = 0;
                              }),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 28),
                  Text(
                    'Montant',
                    style: TextStyle(
                      color: context.textSecondary,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 8),
                  _AmountField(
                    controller: _ctrl,
                    hint: 'Minimum ${_fmtAmt(pool.minStakeAmount)}',
                    symbol: pool.assetSymbol,
                    onChanged: (v) => setState(() => _amount = _parse(v)),
                    onMax: () {
                      _ctrl.text = _fmtInput(_maxAmount(pool, available));
                      setState(() => _amount = _parse(_ctrl.text));
                    },
                  ),
                  const SizedBox(height: 10),
                  if (error != null)
                    Text(
                      error,
                      style: const TextStyle(
                        color: AppColors.bearish,
                        fontSize: 13,
                      ),
                    )
                  else
                    Row(
                      children: [
                        Text(
                          'Dispo',
                          style: TextStyle(
                            color: context.textSecondary,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '${_fmtAmt(available)} ${pool.assetSymbol}',
                          style: TextStyle(
                            color: context.textPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  const SizedBox(height: 28),
                  _TabHeader(
                    labels: const ['Résumé', 'Règles'],
                    index: _tab,
                    onChanged: (i) => setState(() => _tab = i),
                  ),
                  const SizedBox(height: 4),
                  if (_tab == 0) ...[
                    _KV(
                      label: 'Gains est. / jour',
                      value:
                          '${daily.toStringAsFixed(8)} ${pool.rewardAssetSymbol ?? pool.assetSymbol}',
                      valueColor: _green(context),
                    ),
                    _KV(label: 'APY', value: _fmtApy(pool.totalApy)),
                    if (!pool.hasNoLock)
                      _KV(
                        label: 'Déblocage',
                        value: _fmtDate(
                          DateTime.now().add(
                            Duration(days: pool.lockPeriodDays),
                          ),
                        ),
                      ),
                  ] else ...[
                    _KV(
                      label: 'Type',
                      value:
                          pool.hasNoLock
                              ? 'Flexible'
                              : 'Bloqué ${pool.lockPeriodDays} jours',
                    ),
                    _KV(
                      label: 'Minimum',
                      value:
                          '${_fmtAmt(pool.minStakeAmount)} ${pool.assetSymbol}',
                    ),
                    if (pool.maxStakeAmount != null)
                      _KV(
                        label: 'Maximum par utilisateur',
                        value:
                            '${_fmtAmt(pool.maxStakeAmount!)} ${pool.assetSymbol}',
                      ),
                    if (!pool.hasNoLock)
                      _KV(
                        label: 'Retrait anticipé',
                        value:
                            pool.instantUnstakeEnabled
                                ? '${_fmtAmt(pool.instantUnstakeFeePercent ?? 0)}% de frais'
                                : 'Impossible',
                      ),
                  ],
                ],
              ),
            ),
          ),
          _BottomButton(
            label: pool.canStake ? 'Confirmer' : 'Indisponible',
            loading: provider.isActing,
            enabled: canSubmit,
            onTap: () => _confirm(provider, pool),
          ),
        ],
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  final StakingPoolModel pool;
  final bool selected;
  final VoidCallback onTap;
  const _ProductCard({
    required this.pool,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 140,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary.withOpacity(0.10) : null,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? AppColors.primary : context.borderColor,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              pool.hasNoLock ? 'Flexible' : '${pool.lockPeriodDays} jours',
              style: TextStyle(color: context.textSecondary, fontSize: 13),
            ),
            const SizedBox(height: 4),
            Text(
              _fmtApy(pool.totalApy),
              style: TextStyle(
                color: context.textPrimary,
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================================
// 3. MES ACTIFS
// ============================================================================

class _MyAssetsScreen extends StatelessWidget {
  const _MyAssetsScreen();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<StakingProvider>();
    final positions = provider.myPositions;

    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: _appBar(context, 'Mes actifs', null),
      body: RefreshIndicator(
        color: AppColors.primary,
        backgroundColor: context.surfaceHighColor,
        onRefresh: provider.refreshAll,
        child:
            positions.isEmpty
                ? ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: const [
                    SizedBox(height: 80),
                    _EmptyState(
                      icon: Icons.savings_outlined,
                      text: 'Aucun actif en staking',
                    ),
                  ],
                )
                : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                  itemCount: positions.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _PositionCard(pool: positions[i]),
                ),
      ),
    );
  }
}

class _PositionCard extends StatelessWidget {
  final StakingPoolModel pool;
  const _PositionCard({required this.pool});

  /// Avancement du blocage (0..1), null si pool flexible ou débloqué
  double? get _lockProgress {
    if (!pool.isUserLocked || pool.lockPeriodDays <= 0) return null;
    final total = Duration(days: pool.lockPeriodDays);
    final start = pool.unlockAt!.subtract(total);
    final elapsed = DateTime.now().difference(start);
    return (elapsed.inSeconds / total.inSeconds).clamp(0.0, 1.0);
  }

  @override
  Widget build(BuildContext context) {
    final sym = pool.assetSymbol;
    final staked = pool.userStakedAmount ?? 0;
    final perDay = staked * pool.totalApy / 100 / 365;
    final progress = _lockProgress;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.surfaceColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: context.borderColor),
      ),
      child: Column(
        children: [
          Row(
            children: [
              AssetIcon(symbol: sym, size: 36),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      pool.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: context.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    _lockChip(context, pool),
                  ],
                ),
              ),
              Text(
                _fmtApy(pool.totalApy),
                style: TextStyle(
                  color: _green(context),
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _Stat(
                  label: 'En staking',
                  value: '${_fmtAmt(staked)} $sym',
                ),
              ),
              Expanded(
                child: _TickingStat(
                  label: 'Récompenses',
                  pending: pool.userPendingRewards ?? 0,
                  perDay: perDay,
                  symbol: pool.rewardAssetSymbol ?? sym,
                ),
              ),
            ],
          ),
          if (progress != null) ...[
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(2),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 4,
                backgroundColor: context.borderColor,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                _fmtDate(pool.unlockAt!),
                style: TextStyle(color: context.textSecondary, fontSize: 12),
              ),
            ),
          ],
          if (pool.userLockedAmount > 0) ...[
            const SizedBox(height: 4),
            _KV(
              label: 'Garantie prêt',
              value: '${_fmtAmt(pool.userLockedAmount)} $sym',
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed:
                      () => _push(context, _RedeemScreen(poolId: pool.id)),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(44),
                    side: BorderSide(color: context.borderColor),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(
                    'Retirer',
                    style: TextStyle(
                      color: context.textPrimary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton(
                  onPressed:
                      pool.canStake
                          ? () => _push(
                            context,
                            _SubscribeScreen(
                              symbol: sym,
                              initialPoolId: pool.id,
                            ),
                          )
                          : null,
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size.fromHeight(44),
                    backgroundColor: AppColors.primary,
                    disabledBackgroundColor: AppColors.primary.withOpacity(
                      0.25,
                    ),
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text(
                    'Ajouter',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                    ),
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

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  const _Stat({required this.label, required this.value, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(color: context.textSecondary, fontSize: 12),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: valueColor ?? context.textPrimary,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

/// Récompenses qui augmentent en temps réel
class _TickingStat extends StatefulWidget {
  final String label;
  final double pending;
  final double perDay;
  final String symbol;
  const _TickingStat({
    required this.label,
    required this.pending,
    required this.perDay,
    required this.symbol,
  });

  @override
  State<_TickingStat> createState() => _TickingStatState();
}

class _TickingStatState extends State<_TickingStat> {
  late double _shown;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _shown = widget.pending;
    _timer = Timer.periodic(const Duration(milliseconds: 200), (_) {
      if (!mounted) return;
      setState(() => _shown += widget.perDay / 86400 * 0.2);
    });
  }

  @override
  void didUpdateWidget(_TickingStat old) {
    super.didUpdateWidget(old);
    if (widget.pending != old.pending) _shown = widget.pending;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final decimals = _shown < 1 ? 8 : 4;
    return _Stat(
      label: widget.label,
      value: '+${_shown.toStringAsFixed(decimals)} ${widget.symbol}',
      valueColor: _green(context),
    );
  }
}

// ============================================================================
// 4. RETRAIT
// ============================================================================

class _RedeemScreen extends StatefulWidget {
  final String poolId;
  const _RedeemScreen({required this.poolId});

  @override
  State<_RedeemScreen> createState() => _RedeemScreenState();
}

class _RedeemScreenState extends State<_RedeemScreen> {
  final _ctrl = TextEditingController();
  double _amount = 0;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _confirm(StakingProvider provider, StakingPoolModel pool) async {
    final amount = _amount;
    final messenger = ScaffoldMessenger.of(context);
    final result = await provider.unstake(amount, poolId: pool.id);
    if (result != null && result.success) {
      _snack(
        messenger,
        'Reçu ${_fmtAmt(result.totalReceived)} ${pool.assetSymbol}',
      );
      if (mounted) Navigator.pop(context);
    } else {
      _snack(messenger, result?.error ?? provider.error ?? 'Échec du retrait');
      provider.clearError();
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<StakingProvider>();
    final pool = provider.poolById(widget.poolId);

    if (pool == null || pool.userHasStake != true) {
      return Scaffold(
        backgroundColor: context.bgColor,
        appBar: _appBar(context, 'Retirer', pool?.assetSymbol),
        body: const _EmptyState(
          icon: Icons.inbox_outlined,
          text: 'Aucune position',
        ),
      );
    }

    final sym = pool.assetSymbol;
    final maxUnstake = pool.userUnstakable; // hors garantie de prêt
    final rewards = pool.userPendingRewards ?? 0;

    final earlyExit = pool.isUserLocked;
    final blocked = earlyExit && !pool.instantUnstakeEnabled;
    final feePct = earlyExit ? (pool.instantUnstakeFeePercent ?? 0.0) : 0.0;
    final penalty = _amount * feePct / 100;
    final total = _amount - penalty + rewards;

    final tooMuch = _amount > maxUnstake;
    final canSubmit =
        _amount > 0 && !tooMuch && !blocked && !provider.isActing;

    String? error;
    if (blocked) {
      error = 'Disponible le ${_fmtDate(pool.unlockAt!)}';
    } else if (tooMuch) {
      error = 'Montant supérieur au solde retirable';
    }

    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: _appBar(context, sym, sym),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Montant à retirer',
                    style: TextStyle(
                      color: context.textSecondary,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 8),
                  _AmountField(
                    controller: _ctrl,
                    hint: 'Retirable ${_fmtAmt(maxUnstake)}',
                    symbol: sym,
                    onChanged: (v) => setState(() => _amount = _parse(v)),
                    onMax: () {
                      _ctrl.text = _fmtInput(maxUnstake);
                      setState(() => _amount = _parse(_ctrl.text));
                    },
                  ),
                  const SizedBox(height: 10),
                  if (error != null)
                    Text(
                      error,
                      style: const TextStyle(
                        color: AppColors.bearish,
                        fontSize: 13,
                      ),
                    )
                  else
                    Row(
                      children: [
                        Text(
                          'Retirable',
                          style: TextStyle(
                            color: context.textSecondary,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '${_fmtAmt(maxUnstake)} $sym',
                          style: TextStyle(
                            color: context.textPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  const SizedBox(height: 28),
                  Divider(color: context.borderColor, height: 1),
                  const SizedBox(height: 4),
                  _KV(
                    label: 'Récompenses',
                    value: '≈ ${_fmtAmt(rewards)} $sym',
                    valueColor: _green(context),
                  ),
                  if (penalty > 0)
                    _KV(
                      label: 'Frais (${_fmtAmt(feePct)}%)',
                      value: '− ${_fmtAmt(penalty)} $sym',
                      valueColor: AppColors.bearish,
                    ),
                  _KV(
                    label: 'Vous recevez',
                    value:
                        _amount > 0
                            ? '≈ ${_fmtAmt(total < 0 ? 0 : total)} $sym'
                            : '—',
                    bold: true,
                  ),
                ],
              ),
            ),
          ),
          _BottomButton(
            label: 'Confirmer',
            loading: provider.isActing,
            enabled: canSubmit,
            onTap: () => _confirm(provider, pool),
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// WIDGETS PARTAGÉS
// ============================================================================

PreferredSizeWidget _appBar(BuildContext context, String title, String? symbol) {
  return AppBar(
    backgroundColor: context.bgColor,
    surfaceTintColor: Colors.transparent,
    elevation: 0,
    centerTitle: true,
    title: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (symbol != null) ...[
          AssetIcon(symbol: symbol, size: 24),
          const SizedBox(width: 8),
        ],
        Text(
          title,
          style: TextStyle(
            color: context.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

/// Ouvre une page en lui redonnant accès au StakingProvider
/// (scopé à la route StakingScreen, invisible depuis une nouvelle route).
Future<T?> _push<T>(BuildContext context, Widget page) {
  final provider = context.read<StakingProvider>();
  return Navigator.of(context).push<T>(
    MaterialPageRoute(
      builder:
          (_) => ChangeNotifierProvider.value(value: provider, child: page),
    ),
  );
}

Widget _lockChip(BuildContext context, StakingPoolModel pool) {
  return pool.hasNoLock
      ? _Chip(label: 'Flexible', color: _green(context))
      : _Chip(
        label: 'Bloqué ${pool.lockPeriodDays} j',
        color: context.textSecondary,
      );
}

class _AmountField extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final String symbol;
  final ValueChanged<String> onChanged;
  final VoidCallback onMax;
  const _AmountField({
    required this.controller,
    required this.hint,
    required this.symbol,
    required this.onChanged,
    required this.onMax,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.only(left: 16, right: 4),
      decoration: BoxDecoration(
        color: context.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.borderColor),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              style: TextStyle(
                color: context.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
              decoration: InputDecoration(
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                filled: false,
                hintText: hint,
                hintStyle: TextStyle(
                  color: context.textDisabled,
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ),
          Text(
            symbol,
            style: TextStyle(
              color: context.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          TextButton(
            onPressed: onMax,
            child: Text(
              'Max',
              style: TextStyle(
                color: context.linkColor,
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _KV extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool bold;
  const _KV({
    required this.label,
    required this.value,
    this.valueColor,
    this.bold = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 4,
            child: Text(
              label,
              style: TextStyle(color: context.textSecondary, fontSize: 14),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 6,
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: valueColor ?? context.textPrimary,
                fontSize: 14,
                fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TabHeader extends StatelessWidget {
  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;
  const _TabHeader({
    required this.labels,
    required this.index,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: context.borderColor)),
      ),
      child: Row(
        children: [
          for (var i = 0; i < labels.length; i++)
            GestureDetector(
              onTap: () => onChanged(i),
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.only(right: 24),
                child: Column(
                  children: [
                    Text(
                      labels[i],
                      style: TextStyle(
                        color:
                            i == index
                                ? context.textPrimary
                                : context.textSecondary,
                        fontSize: 15,
                        fontWeight:
                            i == index ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      width: 24,
                      height: 3,
                      decoration: BoxDecoration(
                        color:
                            i == index ? AppColors.primary : Colors.transparent,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _BottomButton extends StatelessWidget {
  final String label;
  final bool loading;
  final bool enabled;
  final VoidCallback onTap;
  const _BottomButton({
    required this.label,
    required this.loading,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: context.bgColor,
        border: Border(top: BorderSide(color: context.borderColor)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
          child: SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: enabled ? onTap : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                disabledBackgroundColor: AppColors.primary.withOpacity(0.25),
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child:
                  loading
                      ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                      : Text(
                        label,
                        style: TextStyle(
                          color: enabled ? Colors.white : Colors.white70,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final Color color;
  const _Chip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String text;
  final String? actionLabel;
  final Future<void> Function()? onAction;
  const _EmptyState({
    required this.icon,
    required this.text,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 60, horizontal: 20),
      child: Column(
        children: [
          Icon(icon, size: 40, color: context.textDisabled),
          const SizedBox(height: 12),
          Text(
            text,
            textAlign: TextAlign.center,
            style: TextStyle(color: context.textSecondary, fontSize: 14),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 8),
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
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
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.bearish.withOpacity(0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.bearish.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppColors.bearish, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppColors.bearish, fontSize: 13),
            ),
          ),
          GestureDetector(
            onTap: onDismiss,
            child: const Icon(Icons.close, color: AppColors.bearish, size: 16),
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// HELPERS
// ============================================================================

Color _green(BuildContext context) =>
    context.isDark ? AppColors.bullish : AppColors.bullishOnLight;

double _parse(String v) => double.tryParse(v.replaceAll(',', '.')) ?? 0;

String _fmtApy(double v) => '${v.toStringAsFixed(2)}%';

/// Montant d'un actif : K/M au-dessus de 1000, sinon jusqu'à 8 décimales
/// utiles (0.00000100 BTC -> 0.000001).
String _fmtAmt(double v) {
  if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(2)}M';
  if (v >= 1000) return '${(v / 1000).toStringAsFixed(2)}K';
  if (v >= 1) return v.toStringAsFixed(2);
  if (v <= 0) return '0';
  return v
      .toStringAsFixed(8)
      .replaceFirst(RegExp(r'0+$'), '')
      .replaceFirst(RegExp(r'\.$'), '');
}

/// Valeur d'un champ de saisie : arrondie vers le bas à 8 décimales
/// (jamais au-dessus du solde) et sans zéros inutiles.
String _fmtInput(double v) {
  final floored = (v * 1e8).floor() / 1e8;
  if (floored == floored.truncateToDouble()) return floored.toInt().toString();
  return floored
      .toStringAsFixed(8)
      .replaceFirst(RegExp(r'0+$'), '')
      .replaceFirst(RegExp(r'\.$'), '');
}

String _fmtDate(DateTime d) {
  final l = d.toLocal();
  return '${l.day.toString().padLeft(2, '0')}/'
      '${l.month.toString().padLeft(2, '0')}/${l.year}';
}

/// Snackbar utilisable même après la fermeture de la page appelante
void _snack(ScaffoldMessengerState messenger, String msg) {
  messenger.showSnackBar(
    SnackBar(
      content: Text(
        msg,
        style: TextStyle(color: messenger.context.textPrimary, fontSize: 13),
      ),
      backgroundColor: messenger.context.surfaceHighColor,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      duration: const Duration(seconds: 4),
    ),
  );
}
