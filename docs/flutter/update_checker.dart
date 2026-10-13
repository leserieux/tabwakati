// Contrôle de version de l'app : à copier dans le projet Flutter.
//
// Dépendances (pubspec.yaml) :
//   package_info_plus: ^8.0.0
//   url_launcher: ^6.3.0
//   supabase_flutter: (déjà présent)
//
// Android : aucune permission spéciale pour ouvrir le lien dans le navigateur.
// L'utilisateur télécharge l'APK puis l'installe (Android lui demandera d'autoriser
// « installer des applications inconnues » la première fois).
//
// Utilisation : appeler checkForUpdate(context) une fois, après l'écran d'accueil.

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

Future<void> checkForUpdate(BuildContext context) async {
  try {
    final info = await PackageInfo.fromPlatform();
    final current = int.tryParse(info.buildNumber) ?? 0;

    final row = await Supabase.instance.client
        .from('app_versions')
        .select()
        .eq('platform', 'android')
        .maybeSingle();
    if (row == null) return;

    final latest = row['latest_build'] as int;
    final minimum = row['min_build'] as int;
    if (current >= latest) return;

    final force = current < minimum; // mise à jour obligatoire
    final url = Uri.parse(row['apk_url'] as String);
    final name = (row['latest_name'] as String?) ?? '';
    final notes = (row['notes'] as String?) ?? 'Une nouvelle version est disponible.';

    if (!context.mounted) return;
    await showDialog(
      context: context,
      barrierDismissible: !force,
      builder: (_) => PopScope(
        canPop: !force,
        child: AlertDialog(
          title: Text(name.isEmpty ? 'Mise à jour disponible' : 'Nouvelle version $name'),
          content: Text(force ? '$notes\n\nCette mise à jour est obligatoire pour continuer.' : notes),
          actions: [
            if (!force)
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Plus tard'),
              ),
            FilledButton(
              onPressed: () => launchUrl(url, mode: LaunchMode.externalApplication),
              child: const Text('Mettre à jour'),
            ),
          ],
        ),
      ),
    );
  } catch (_) {
    // Pas de réseau ou table absente : on ne bloque jamais l'utilisateur à cause du contrôle de version.
  }
}
