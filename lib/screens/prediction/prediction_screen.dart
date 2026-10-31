// lib/screens/prediction/prediction_screen.dart
//
// Écran « Prédiction » — refonte complète.
//
// Structure :
//   PriceHeroCard      prix BTC en direct + mini-graphique
//   AccountStrip       solde · paris du jour · série
//   BetPanel           choix Hausse / Baisse  (ou)  ActiveBetCard  pari en cours
//   OnboardingCard     aide pour les nouveaux joueurs
//   StatsCard          performances
//   HistoryCard        historique détaillé
//
// Les feuilles modales (confirmation, règles, résultat) sont ouvertes ici.


import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakati/appconfigtheme/app_theme.dart';
import 'package:wakati/models/prediction_model.dart';
import 'package:wakati/providers/prediction_provider.dart';
import 'package:wakati/screens/game/buy_wakati_screen.dart';

import 'active_bet_card.dart';
import 'bet_panel.dart';
import 'prediction_common.dart';
import 'price_hero_card.dart';
import 'result_sheet.dart';
import 'stats_history.dart';

class PredictionScreen extends StatefulWidget {
  const PredictionScreen({super.key});

  @override
  State<PredictionScreen> createState() => _PredictionScreenState();
}

class _PredictionScreenState extends State<PredictionScreen> {
  static const String _prefConfirm = 'prediction_confirm_bets';

  PredictionProvider? _p;
  bool _visible = true; // l'onglet est-il à l'écran ?
  bool _sheetOpen = false; // feuille de résultat déjà ouverte ?
  bool _confirmBets = true;

  // ──────────────────────────────────────
  // CYCLE DE VIE
  // ──────────────────────────────────────

  @override
  void initState() {
    super.initState();
    _loadPrefs();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _p = context.read<PredictionProvider>();
      _p!.addListener(_onProviderChanged);
      _p!.initialize();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // L'écran vit dans un IndexedStack : TickerMode indique s'il est visible.
    final visible = TickerMode.of(context);
    if (visible != _visible) {
      _visible = visible;
      if (visible) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _maybeShowResult());
      }
    }
  }

  @override
  void dispose() {
    _p?.removeListener(_onProviderChanged);
    super.dispose();
  }

  Future<void> _loadPrefs() async {
    try {
      final sp = await SharedPreferences.getInstance();
      final v = sp.getBool(_prefConfirm);
      if (v != null && mounted) setState(() => _confirmBets = v);
    } catch (_) {}
  }

  Future<void> _setConfirm(bool v) async {
    setState(() => _confirmBets = v);
    HapticFeedback.selectionClick();
    try {
      final sp = await SharedPreferences.getInstance();
      await sp.setBool(_prefConfirm, v);
    } catch (_) {}
  }

  // ──────────────────────────────────────
  // ACTIONS
  // ──────────────────────────────────────

  void _onProviderChanged() => _maybeShowResult();

  /// Ouvre la feuille de résultat dès qu'un pari vient d'être résolu
  /// (et que l'onglet est visible).
  Future<void> _maybeShowResult() async {
    final p = _p;
    if (!mounted || p == null || _sheetOpen || !_visible) return;
    final r = p.lastResult;
    if (r == null) return;

    _sheetOpen = true;
    if (r.isWon) {
      HapticFeedback.heavyImpact();
    } else {
      HapticFeedback.mediumImpact();
    }

    final action = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder:
          (_) => ResultSheet(
            result: r,
            currency: p.config?.currencySymbol ?? 'WAKATI',
          ),
    );

    _sheetOpen = false;
    if (!mounted) return;
    p.clearLastResult();

    if (action == 'replay' && r.direction != null) {
      final cfg = p.config;
      if (cfg == null) return;
      final amount =
          cfg.betMode == 'fixed'
              ? cfg.betAmount
              : r.betAmount.clamp(cfg.betMin, cfg.betMax).toDouble();
      await _startBet(r.direction!, amount);
    }
  }

  Future<void> _startBet(String direction, double amount) async {
    final p = _p ?? context.read<PredictionProvider>();
    final cfg = p.config;
    if (cfg == null) return;

    HapticFeedback.selectionClick();

    if (_confirmBets) {
      final ok = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder:
            (_) => ConfirmBetSheet(
              provider: p,
              direction: direction,
              amount: amount,
            ),
      );
      if (ok != true || !mounted) return;
    }

    final success =
        cfg.betMode == 'fixed'
            ? await p.placeBet(direction)
            : await p.placeBetWithAmount(direction, amount);

    if (!mounted) return;
    if (success) {
      HapticFeedback.mediumImpact();
    } else {
      HapticFeedback.heavyImpact();
    }
  }

  Future<void> _recharge() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const BuyWakatiScreen()),
    );
    if (!mounted) return;
    _p?.loadState(silent: true);
  }

  // ──────────────────────────────────────
  // BUILD
  // ──────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      body: Consumer<PredictionProvider>(
        builder: (ctx, p, _) {
          final cfg = p.config;

          // Premier chargement : squelette
          if (p.isLoading && cfg == null) return const PredictionSkeleton();

          final sections = <Widget>[];
          int delay = 0;
          void add(String id, Widget w) {
            if (sections.isNotEmpty) sections.add(const SizedBox(height: 14));
            sections.add(FadeSlideIn(key: ValueKey(id), delayMs: delay, child: w));
            delay += 60;
          }

          // Résultat (secours si la feuille n'a pas pu s'ouvrir)
          final r = p.lastResult;
          if (r != null && !_visible) {
            add(
              'result_banner',
              _ResultBanner(
                result: r,
                currency: cfg?.currencySymbol ?? 'WAKATI',
                onClose: p.clearLastResult,
              ),
            );
          }

          // Prix en direct
          add(
            'hero',
            PriceHeroCard(
              assetName: cfg?.assetName ?? 'Bitcoin',
              assetSymbol: cfg?.assetSymbol ?? 'BTC',
              price: p.currentPrice,
              change24h: p.priceChange,
              loading: p.priceLoading,
              stale: p.priceStale,
              history: p.priceHistory,
            ),
          );

          if (cfg != null) {
            add(
              'account',
              AccountStrip(
                balance: p.balance,
                currency: cfg.currencySymbol,
                betsToday: p.betsToday,
                maxBets: cfg.maxBetsPerDay,
                winStreak: p.stats.winStreak,
              ),
            );
          }

          // Erreur
          if (p.error != null && cfg != null) {
            add(
              'error',
              _ErrorBanner(message: p.error!, onClose: p.clearError),
            );
          }

          // Zone principale
          if (cfg == null) {
            add(
              'unavailable',
              _UnavailableCard(
                message: p.error,
                onRetry: () => p.initialize(),
              ),
            );
          } else if (p.hasPendingBet) {
            add('active', ActiveBetCard(provider: p));
          } else {
            add(
              'bet',
              BetPanel(
                provider: p,
                confirmBets: _confirmBets,
                onConfirmChanged: _setConfirm,
                onBet: _startBet,
                onRecharge: _recharge,
              ),
            );
          }

          // Nouveaux joueurs
          if (cfg != null &&
              !p.hasPendingBet &&
              p.stats.totalBets == 0 &&
              p.history.isEmpty) {
            add('onboarding', OnboardingCard(cfg: cfg));
          }

          // Performances + historique
          if (p.stats.totalBets > 0) {
            add(
              'stats',
              StatsCard(
                stats: p.stats,
                history: p.history,
                currency: cfg?.currencySymbol ?? 'WAKATI',
              ),
            );
          }
          if (p.history.isNotEmpty) {
            add(
              'history',
              HistoryCard(
                history: p.history,
                currency: cfg?.currencySymbol ?? 'WAKATI',
              ),
            );
          }

          // Mention responsable
          add(
            'disclaimer',
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Text(
                'Jeu de prédiction à risque : vous pouvez perdre votre mise.\n'
                'Jouez de manière responsable.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: ctx.textDisabled,
                  fontSize: 11.5,
                  height: 1.5,
                ),
              ),
            ),
          );

          return RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: ctx.surfaceColor,
            onRefresh: p.initialize,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: Column(children: sections),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ═════════════════════════════════════════════
//  BANNIÈRES
// ═════════════════════════════════════════════

class _ErrorBanner extends StatelessWidget {
  final String message;
  final VoidCallback onClose;
  const _ErrorBanner({required this.message, required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      decoration: BoxDecoration(
        color: AppColors.bearish.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.bearish.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline_rounded, color: AppColors.bearish, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: context.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.w600,
                height: 1.35,
              ),
            ),
          ),
          IconButton(
            onPressed: onClose,
            visualDensity: VisualDensity.compact,
            icon: Icon(Icons.close_rounded, size: 18, color: context.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _ResultBanner extends StatelessWidget {
  final BetResult result;
  final String currency;
  final VoidCallback onClose;
  const _ResultBanner({
    required this.result,
    required this.currency,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final won = result.isWon;
    final refunded = result.isRefunded;
    final color =
        won ? AppColors.bullish : (refunded ? AppColors.warning : AppColors.bearish);
    final title =
        won
            ? 'Gagné ! ${fmtSigned(result.profitAmount)} $currency'
            : (refunded
                ? 'Pari remboursé'
                : 'Perdu ${fmtSigned(result.profitAmount)} $currency');
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          Icon(
            won
                ? Icons.emoji_events_rounded
                : (refunded ? Icons.replay_rounded : Icons.trending_down_rounded),
            color: color,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: color,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${fmtUsd(result.priceAtBet)} → ${fmtUsd(result.priceAtResolution)}',
                  style: TextStyle(color: context.textSecondary, fontSize: 12.5),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onClose,
            visualDensity: VisualDensity.compact,
            icon: Icon(Icons.close_rounded, size: 18, color: context.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _UnavailableCard extends StatelessWidget {
  final String? message;
  final VoidCallback onRetry;
  const _UnavailableCard({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return PredCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.warning.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.cloud_off_rounded, color: AppColors.warning, size: 28),
          ),
          const SizedBox(height: 14),
          Text(
            'Jeu momentanément indisponible',
            style: TextStyle(
              color: context.textPrimary,
              fontSize: 16.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            message ?? 'Vérifiez votre connexion puis réessayez.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: context.textSecondary,
              fontSize: 13,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: PredGradientButton(
              label: 'Réessayer',
              icon: Icons.refresh_rounded,
              gradient: AppColors.primaryGradient,
              glow: AppColors.primary,
              onTap: onRetry,
            ),
          ),
        ],
      ),
    );
  }
}
