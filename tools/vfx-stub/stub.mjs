/* Stub of the daggerheart-vfx API (spec §7) for testing the companion. Local Foundry only. */
Hooks.once("ready", () => {
  game.modules.get("daggerheart-vfx").api = {
    haEffetto: (item, azioneId) => !!item,
    gioca: async ({ item, azioneId, origine, bersagli }) => {
      console.log("daggerheart-vfx STUB | gioca", { item: item?.name, azioneId, origine, bersagli });
      const token = canvas?.ready ? canvas.tokens.get(origine) : null;
      if (!token) return false;
      ui.notifications.info(`VFX stub: ${item?.name} da ${token.name} → ${bersagli.length} bersagli`);
      return true;
    }
  };
});
