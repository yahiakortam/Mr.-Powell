require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const TOKEN            = process.env.TOKEN;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const GUILD_ID         = process.env.GUILD_ID;

if (!TOKEN) {
  console.error('ERROR: TOKEN environment variable is missing. The bot cannot start.');
  process.exit(1);
}

// ─── XP System ────────────────────────────────────────────────────────────────
// XP is stored in xp.json in the project folder.
// NOTE: On Render's free tier the filesystem is ephemeral — XP resets on redeploy.
// To make XP permanent, swap the file functions below for a database (MongoDB Atlas free tier works well).

const XP_FILE = path.join(__dirname, 'xp.json');

const LEVELS = [
  { number: 1,  title: 'Sitting on the Carpet',       xp: 0    },
  { number: 2,  title: 'Reluctant Participant',        xp: 50   },
  { number: 3,  title: 'Triangle Holder',              xp: 150  },
  { number: 4,  title: 'Drum Circle Member',           xp: 300  },
  { number: 5,  title: 'Bell Finder',                  xp: 500  },
  { number: 6,  title: 'Front Row Survivor',           xp: 800  },
  { number: 7,  title: 'Trusted With the Instruments', xp: 1200 },
  { number: 8,  title: "Teacher's Favorite",           xp: 1700 },
  { number: 9,  title: 'Music Room Legend',            xp: 2500 },
  { number: 10, title: "Mr. Powell's Successor",       xp: 3500 },
];

function loadXP() {
  try {
    if (fs.existsSync(XP_FILE)) return JSON.parse(fs.readFileSync(XP_FILE, 'utf8'));
  } catch { /* file missing or corrupt — start fresh */ }
  return {};
}

function saveXP(data) {
  try { fs.writeFileSync(XP_FILE, JSON.stringify(data, null, 2)); }
  catch (err) { console.error('Failed to save XP data:', err); }
}

function addXP(userId, amount) {
  const data  = loadXP();
  data[userId] = Math.max(0, (data[userId] || 0) + amount);
  saveXP(data);
  return data[userId];
}

function getXP(userId) {
  return loadXP()[userId] || 0;
}

function getLevelInfo(xp) {
  let current = LEVELS[0];
  let next    = LEVELS[1];
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].xp) {
      current = LEVELS[i];
      next    = LEVELS[i + 1] || null;
      break;
    }
  }
  return { current, next };
}

function buildXPBar(xp, current, next) {
  if (!next) return '`██████████` MAX LEVEL';
  const progress = xp - current.xp;
  const total    = next.xp - current.xp;
  const filled   = Math.min(10, Math.round((progress / total) * 10));
  const empty    = 10 - filled;
  return `\`${'█'.repeat(filled)}${'░'.repeat(empty)}\` ${progress}/${total} XP to next level`;
}

// ─── Client Setup ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Active bell games: userId → { target, guesses, maxGuesses }
const activeGames = new Map();

// Tracks how many times /banaga has been used this session
let banagaCount = 0;

// ─── Multiplayer Game State ───────────────────────────────────────────────────
let activeHeist   = null;
let activeAuction = null;
let activeQuiz    = null;
const activeDuels  = new Map();
const mvpCooldowns = new Map(); // userId → timestamp of last /mvp use

// ─── Slash Command Definitions ────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('findthebell')
    .setDescription('Mr. Powell hid the bell somewhere between 1 and 100. Find it.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('discipline')
    .setDescription('Mr. Powell disciplines a student.')
    .addUserOption(o => o.setName('user').setDescription('The student to discipline').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Mr. Powell welcomes the class to Made New.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription("Check a student's real music class level based on their XP.")
    .addUserOption(o => o.setName('user').setDescription('The student to check (defaults to you)').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Check how much XP you or someone else has.')
    .addUserOption(o => o.setName('user').setDescription('The student to check (defaults to you)').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Mr. Powell posts the class leaderboard.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('banaga')
    .setDescription('...')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('gametime')
    .setDescription('Mr. Powell reluctantly dismisses class for gaming.')
    .addStringOption(o =>
      o.setName('game')
        .setDescription('What game is the class playing tonight')
        .setRequired(true)
        .addChoices(
          { name: 'Valorant',     value: 'valorant'  },
          { name: 'Minecraft',    value: 'minecraft' },
          { name: 'Tarkov',       value: 'tarkov'    },
          { name: 'Fortnite',     value: 'fortnite'  },
          { name: 'Party Games',  value: 'party'     },
          { name: 'Other',        value: 'other'     },
        )
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('mvp')
    .setDescription("Mr. Powell names tonight's MVP.")
    .addUserOption(o => o.setName('user').setDescription('The MVP').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('lesson')
    .setDescription("Mr. Powell announces today's lesson.")
    .toJSON(),

  new SlashCommandBuilder()
    .setName('absent')
    .setDescription('Mr. Powell marks a student as absent.')
    .addUserOption(o => o.setName('user').setDescription('The student who did not show up').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('powellsays')
    .setDescription('Mr. Powell shares a piece of wisdom.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('beef')
    .setDescription('Mr. Powell mediates a dispute between two students.')
    .addUserOption(o => o.setName('user1').setDescription('First person').setRequired(true))
    .addUserOption(o => o.setName('user2').setDescription('Second person').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('heist')
    .setDescription("Organize a heist on Mr. Powell's bell room. Others can join.")
    .toJSON(),

  new SlashCommandBuilder()
    .setName('auction')
    .setDescription('Mr. Powell auctions a class title. Bid with your real XP.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('musictest')
    .setDescription('Mr. Powell gives the class a pop quiz. First correct answer wins XP.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('duel')
    .setDescription('Challenge a student to a duel. Winner takes XP from the loser.')
    .addUserOption(o => o.setName('user').setDescription('The student to challenge').setRequired(true))
    .toJSON(),
];

// ─── Error Listeners ─────────────────────────────────────────────────────────

client.on('error',      error => console.error('Discord client error:', error));
client.on('shardError', error => console.error('Discord shard error:',  error));

// ─── Ready Event ──────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}.`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Slash commands registered. Class is now in session.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

// ─── New Member Welcome ───────────────────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
  if (!WELCOME_CHANNEL_ID) {
    console.error('WELCOME_CHANNEL_ID is missing. Cannot send welcome message.');
    return;
  }

  const messages = [
    `Welcome ${member}. I'm Mr. Powell. I'll be taking attendance, keeping the instruments safe, and making sure this server doesn't fall apart.`,
    `${member} has entered the music room. I'm Mr. Powell, and I'll be here to guide you through whatever this server turns into.`,
    `Welcome ${member}. I'm Mr. Powell. Find a seat, don't touch the guitar, and try not to get written on the board.`,
    `${member} joined. I'm Mr. Powell, your official Made New music teacher. I'll be watching the class closely.`,
    `Welcome to Made New, ${member}. I'm Mr. Powell. My job is to keep order, run the bell game, and maintain what little control this class has left.`,
    `Everyone welcome ${member}. I'm Mr. Powell, and I'll be helping keep this server organized, disciplined, and barely under control.`,
    `${member} has been added to attendance. I'm Mr. Powell. Please keep your hands to yourself and do not abuse the tambourine.`,
    `Welcome ${member}. I'm Mr. Powell. I'll help you find your way around, but I cannot help if you choose to enter banaga.`,
    `${member} just joined the class. I'm Mr. Powell, and I'll be making sure nobody ruins music time.`,
    `Welcome ${member}. I'm Mr. Powell. This server is now slightly more crowded and probably less manageable.`,
  ];

  try {
    const channel = await client.channels.fetch(WELCOME_CHANNEL_ID);
    if (!channel?.isTextBased()) {
      console.error(`Welcome channel (ID: ${WELCOME_CHANNEL_ID}) not found or not a text channel.`);
      return;
    }
    await channel.send(messages[Math.floor(Math.random() * messages.length)]);
  } catch (error) {
    console.error('Failed to send welcome message:', error);
  }
});

// ─── Interaction Router ───────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('bell_guess_modal__')) await handleBellGuessModal(interaction);
    if (interaction.customId === 'auction_bid_modal')          await handleAuctionBidModal(interaction);
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('bell_guess_btn__'))    await handleBellGuessButton(interaction);
    if (interaction.customId.startsWith('discipline_appeal__')) await handleDisciplineAppeal(interaction);
    if (interaction.customId === 'heist_join')                  await handleHeistJoin(interaction);
    if (interaction.customId === 'auction_bid_btn')             await handleAuctionBidButton(interaction);
    if (interaction.customId.startsWith('quiz_answer__'))       await handleQuizAnswer(interaction);
    if (interaction.customId.startsWith('duel_accept__'))       await handleDuelAccept(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'findthebell': await handleFindTheBell(interaction); break;
    case 'discipline':  await handleDiscipline(interaction);  break;
    case 'welcome':     await handleWelcome(interaction);     break;
    case 'level':       await handleLevel(interaction);       break;
    case 'xp':          await handleXP(interaction);          break;
    case 'leaderboard': await handleLeaderboard(interaction); break;
    case 'banaga':      await handleBanaga(interaction);      break;
    case 'gametime':    await handleGametime(interaction);    break;
    case 'mvp':         await handleMVP(interaction);         break;
    case 'lesson':      await handleLesson(interaction);      break;
    case 'absent':      await handleAbsent(interaction);      break;
    case 'powellsays':  await handlePowellSays(interaction);  break;
    case 'beef':        await handleBeef(interaction);        break;
    case 'heist':       await handleHeist(interaction);       break;
    case 'auction':     await handleAuction(interaction);     break;
    case 'musictest':   await handleMusicTest(interaction);   break;
    case 'duel':        await handleDuel(interaction);        break;
  }
});

// ─── Bell Game Helpers ────────────────────────────────────────────────────────

function getHeat(distance) {
  if (distance === 0)  return { label: '🔔 FOUND IT',   bar: '🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔', color: 0xFFD700 };
  if (distance <= 3)   return { label: '🔥 SCORCHING',  bar: '🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥', color: 0xFF0000 };
  if (distance <= 8)   return { label: '🔥 BURNING',    bar: '🟥🟥🟥🟥🟥🟥🟥🟧🟧🟧', color: 0xFF4500 };
  if (distance <= 15)  return { label: '♨️ VERY WARM',  bar: '🟧🟧🟧🟧🟧🟧🟧🟦🟦🟦', color: 0xFF8C00 };
  if (distance <= 25)  return { label: '🌡️ WARM',       bar: '🟨🟨🟨🟨🟨🟨🟦🟦🟦🟦', color: 0xFFD700 };
  if (distance <= 40)  return { label: '❄️ COLD',       bar: '🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦', color: 0x4169E1 };
  return                      { label: '🧊 ICE COLD',   bar: '🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵', color: 0x00BFFF };
}

function buildBellEmbed(user, guesses, lastHeat, maxGuesses, won, lost, target) {
  const guessesLeft = maxGuesses - guesses.length;
  let title, description, color, bar;

  if (won) {
    title       = '🔔  Bell Found!';
    description = `${user} found the bell in **${guesses.length}** guess${guesses.length !== 1 ? 'es' : ''}.\nMr. Powell is speechless. Class may continue. **+30 XP**`;
    color       = 0xFFD700;
    bar         = '🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔';
  } else if (lost) {
    title       = '💀  Game Over';
    description = `${user} ran out of guesses. The bell was at **${target}**.\nMr. Powell is deeply disappointed. The whole class loses recess. **+5 XP** for showing up.`;
    color       = 0x808080;
    bar         = '⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛';
  } else if (guesses.length === 0) {
    title       = '🔔  Find the Bell';
    description = `Mr. Powell has hidden the bell somewhere between **1** and **100**.\nThe music gets louder the closer you are. You have **${maxGuesses}** guesses.`;
    color       = 0x5865F2;
    bar         = '⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜';
  } else {
    title       = '🔔  Find the Bell';
    description = `Last guess: **${guesses[guesses.length - 1].number}**  —  ${lastHeat.label}`;
    color       = lastHeat.color;
    bar         = lastHeat.bar;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .addFields({ name: '🎵  Music Volume', value: bar });

  if (guesses.length > 0) {
    const lines = guesses.map((g, i) => {
      let arrow = '';
      if (i > 0) {
        const prev = Math.abs(guesses[i - 1].number - target);
        const curr = Math.abs(g.number - target);
        arrow = curr < prev ? '  📈 warmer' : curr > prev ? '  📉 colder' : '  ↔️ same';
      }
      return `**${g.number}** → ${g.heat}${arrow}`;
    });
    embed.addFields({ name: '📋  Guess History', value: lines.join('\n') });
  }

  if (!won && !lost) {
    embed.addFields({ name: '🎯  Guesses Left', value: `${guessesLeft} of ${maxGuesses}` });
    embed.setFooter({ text: 'Click Make a Guess and enter a number between 1 and 100.' });
  }

  return embed;
}

function buildGuessButton(userId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bell_guess_btn__${userId}`)
      .setLabel('Make a Guess')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔔')
      .setDisabled(disabled)
  );
}

// ─── Bell Game Handlers ───────────────────────────────────────────────────────

async function handleFindTheBell(interaction) {
  if (activeGames.has(interaction.user.id)) {
    await interaction.reply({ content: 'Mr. Powell says you already have an active game. Finish it first.', ephemeral: true });
    return;
  }

  const target = Math.floor(Math.random() * 100) + 1;
  activeGames.set(interaction.user.id, { target, guesses: [], maxGuesses: 7 });

  await interaction.reply({
    embeds: [buildBellEmbed(interaction.user, [], null, 7, false, false, target)],
    components: [buildGuessButton(interaction.user.id)],
  });
}

async function handleBellGuessButton(interaction) {
  const userId = interaction.customId.split('__')[1];

  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'Mr. Powell says this is not your game to play.', ephemeral: true });
    return;
  }

  if (!activeGames.get(userId)) {
    await interaction.reply({ content: 'No active game. Use /findthebell to start one.', ephemeral: true });
    return;
  }

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`bell_guess_modal__${userId}`)
      .setTitle('🔔 Where is the bell?')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('guess_input')
            .setLabel('Enter a number between 1 and 100')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(3)
            .setPlaceholder('e.g. 42')
        )
      )
  );
}

async function handleBellGuessModal(interaction) {
  const userId = interaction.customId.split('__')[1];
  const game   = activeGames.get(userId);

  if (!game) {
    await interaction.reply({ content: 'No active game. Use /findthebell to start one.', ephemeral: true });
    return;
  }

  const guess = parseInt(interaction.fields.getTextInputValue('guess_input'), 10);

  if (isNaN(guess) || guess < 1 || guess > 100) {
    await interaction.reply({ content: 'Mr. Powell says that is not valid. Enter a whole number between 1 and 100.', ephemeral: true });
    return;
  }

  const distance = Math.abs(guess - game.target);
  const heat     = getHeat(distance);

  game.guesses.push({ number: guess, heat: heat.label });

  const won  = distance === 0;
  const lost = !won && game.guesses.length >= game.maxGuesses;

  if (won || lost) {
    activeGames.delete(userId);
    addXP(userId, won ? 30 : 5);
  }

  await interaction.update({
    embeds:     [buildBellEmbed(interaction.user, game.guesses, heat, game.maxGuesses, won, lost, game.target)],
    components: won || lost ? [] : [buildGuessButton(userId)],
  });
}

// ─── Discipline ───────────────────────────────────────────────────────────────

async function handleDiscipline(interaction) {
  const target = interaction.options.getUser('user');

  const messages = [
    `${target} has been moved to the front row.`,
    `Mr. Powell wrote ${target}'s name on the board.`,
    `${target} has lost instrument privileges.`,
    `Mr. Powell is silently waiting for ${target} to stop talking.`,
    `${target} has been separated from the group.`,
    `${target} is no longer trusted with the tambourine.`,
    `${target} has been caught talking during music time.`,
    `${target} must now sit where Mr. Powell can see them.`,
    `${target} has been given a warning. This is the last one.`,
    `Mr. Powell has placed ${target} on the class watchlist.`,
  ];

  const appealButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`discipline_appeal__${target.id}`)
      .setLabel('Appeal to Mr. Powell')
      .setStyle(ButtonStyle.Secondary)
  );

  addXP(target.id, 5);

  await interaction.reply({
    content:    messages[Math.floor(Math.random() * messages.length)],
    components: [appealButton],
  });
}

async function handleDisciplineAppeal(interaction) {
  const disciplinedUserId = interaction.customId.split('__')[1];

  if (interaction.user.id !== disciplinedUserId) {
    await interaction.reply({ content: 'Mr. Powell says this appeal is not yours to file.', ephemeral: true });
    return;
  }

  const denials = [
    "Appeal denied. Mr. Powell does not negotiate.",
    "Request reviewed. Denied. The board is written in permanent marker.",
    "Appeal rejected. Mr. Powell has already moved on.",
    "Denied. Mr. Powell does not operate an appeals process.",
    "Mr. Powell read the appeal. He disagrees. Denied.",
    "Appeal denied. Mr. Powell says your behavior speaks for itself.",
    "Rejected. Mr. Powell said no before he even finished reading it.",
    "Denied. The decision stands. Mr. Powell has left the room.",
  ];

  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`discipline_appeal__${disciplinedUserId}`)
      .setLabel('Appeal Denied')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true)
  );

  await interaction.update({ components: [disabledRow] });
  await interaction.followUp(denials[Math.floor(Math.random() * denials.length)]);
}

// ─── Welcome ──────────────────────────────────────────────────────────────────

async function handleWelcome(interaction) {
  await interaction.reply(
    "Welcome to Made New. Mr. Powell has taken attendance. Keep your hands to yourself, don't touch the instruments without permission, and join VC when instructed."
  );
}

// ─── Level ────────────────────────────────────────────────────────────────────

async function handleLevel(interaction) {
  const target  = interaction.options.getUser('user') || interaction.user;
  const xp      = getXP(target.id);
  const { current, next } = getLevelInfo(xp);

  const embed = new EmbedBuilder()
    .setTitle(`🎵 ${target.username}'s Music Class Level`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'Level',    value: `**${current.number} — ${current.title}**`, inline: false },
      { name: 'Total XP', value: `${xp} XP`,                                inline: true  },
      { name: 'Progress', value: buildXPBar(xp, current, next),              inline: false },
    )
    .setFooter({ text: 'Earn XP by using commands, winning the bell game, and getting disciplined.' });

  await interaction.reply({ embeds: [embed] });
}

// ─── XP ───────────────────────────────────────────────────────────────────────

async function handleXP(interaction) {
  const target  = interaction.options.getUser('user') || interaction.user;
  const xp      = getXP(target.id);
  const { current, next } = getLevelInfo(xp);

  await interaction.reply(
    `${target} has **${xp} XP** — Level **${current.number}: ${current.title}**. ${next ? `Next level at ${next.xp} XP.` : 'Maximum level reached.'}`
  );
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

async function handleLeaderboard(interaction) {
  await interaction.deferReply();

  const data    = loadXP();
  const sorted  = Object.entries(data).sort(([, a], [, b]) => b - a).slice(0, 10);

  if (sorted.length === 0) {
    await interaction.editReply('Mr. Powell says nobody has earned any XP yet. Unacceptable.');
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines  = await Promise.all(
    sorted.map(async ([userId, xp], i) => {
      const { current } = getLevelInfo(xp);
      try {
        const user = await client.users.fetch(userId);
        return `${medals[i] || `**${i + 1}.**`} ${user.username} — ${xp} XP *(${current.title})*`;
      } catch {
        return `${medals[i] || `**${i + 1}.**`} Unknown Student — ${xp} XP *(${current.title})*`;
      }
    })
  );

  const embed = new EmbedBuilder()
    .setTitle('📋 Mr. Powell\'s Class Leaderboard')
    .setDescription(lines.join('\n'))
    .setColor(0xFFD700)
    .setFooter({ text: 'Mr. Powell is watching the rankings closely.' });

  await interaction.editReply({ embeds: [embed] });
}

// ─── Banaga ───────────────────────────────────────────────────────────────────

async function handleBanaga(interaction) {
  banagaCount++;
  addXP(interaction.user.id, 3);

  // Escalating responses based on how many times it has been said this session
  if (banagaCount >= 10) {
    await interaction.reply('Banaga has been said 10 times. Mr. Powell has left the building. Class is cancelled indefinitely. Everyone go home.');
    return;
  }
  if (banagaCount >= 7) {
    await interaction.reply(`Banaga count: **${banagaCount}**. Mr. Powell has sent a formal complaint to the principal. This is being documented.`);
    return;
  }
  if (banagaCount >= 5) {
    await interaction.reply(`Banaga count: **${banagaCount}**. Mr. Powell is on the phone. The word banaga was mentioned. The situation is escalating.`);
    return;
  }

  const messages = [
    'Mr. Powell heard banaga and stopped the entire lesson.',
    'Banaga has been added to the lesson plan.',
    'Mr. Powell does not know what banaga means, but he is concerned.',
    'The class said banaga too many times. Everyone lost music privileges.',
    'Banaga detected. Recorder test postponed.',
    'Someone said banaga and now Mr. Powell is standing silently at the front of the room.',
    'Banaga has been reported to the principal.',
    'Mr. Powell wrote banaga on a notepad and stared at it for thirty seconds.',
    'Banaga is not a word Mr. Powell recognizes, and yet here we are.',
  ];

  await interaction.reply(messages[Math.floor(Math.random() * messages.length)]);
}

// ─── Gametime ─────────────────────────────────────────────────────────────────

async function handleGametime(interaction) {
  const game = interaction.options.getString('game');

  const responses = {
    valorant:  "Fine. Valorant. Mr. Powell does not know what that is, but he expects everyone back in their seats before sunrise. Do not embarrass Made New.",
    minecraft: "Minecraft. Mr. Powell has been told this involves building and survival. He approves of structure and preparation. Class dismissed.",
    tarkov:    "Tarkov. Mr. Powell looked this up. He is concerned about the content. He is more concerned that you enjoy it. Class dismissed. Be careful.",
    fortnite:  "Fortnite. Mr. Powell confiscated a student's phone for playing this in 2018. He has not changed his opinion. Class dismissed regardless.",
    party:     "Party games. Mr. Powell respects structured group activities. Do not let it get loud. If someone cries, class is back in session immediately.",
    other:     "Mr. Powell does not know what you are playing tonight. He chose not to ask. Class dismissed. Make good decisions.",
  };

  addXP(interaction.user.id, 5);
  await interaction.reply(responses[game]);
}

// ─── MVP ──────────────────────────────────────────────────────────────────────

async function handleMVP(interaction) {
  const target = interaction.options.getUser('user');

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: 'Mr. Powell says you cannot name yourself MVP. Sit down.', ephemeral: true });
    return;
  }

  const lastUsed = mvpCooldowns.get(interaction.user.id);
  if (lastUsed && Date.now() - lastUsed < 60 * 60 * 1000) {
    const minutesLeft = Math.ceil((60 * 60 * 1000 - (Date.now() - lastUsed)) / 60000);
    await interaction.reply({ content: `Mr. Powell says you already named an MVP recently. You can do it again in **${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}**.`, ephemeral: true });
    return;
  }

  mvpCooldowns.set(interaction.user.id, Date.now());

  const messages = [
    `Mr. Powell has named ${target} as tonight's MVP. They have been awarded First Chair, which carries no actual privileges but significant respect.`,
    `Tonight's MVP is ${target}. Mr. Powell noticed, which is rare. He is still processing his feelings about it.`,
    `${target} has been named MVP by Mr. Powell. They are now Trusted With the Instruments, effective immediately.`,
    `Mr. Powell is presenting the Made New MVP award to ${target}. The class applauds. Mr. Powell does not clap, but he nods.`,
    `${target} played exceptionally tonight. Mr. Powell has updated the gradebook accordingly. This is high praise.`,
  ];

  addXP(target.id, 40);

  const embed = new EmbedBuilder()
    .setTitle('🏆 MVP of the Night')
    .setDescription(messages[Math.floor(Math.random() * messages.length)])
    .setColor(0xFFD700)
    .setFooter({ text: '+40 XP awarded.' });

  await interaction.reply({ embeds: [embed] });
}

// ─── Lesson ───────────────────────────────────────────────────────────────────

async function handleLesson(interaction) {
  const lessons = [
    "**Today's lesson: Dynamics.** Knowing when to be loud and when to be quiet. This applies to Valorant. It applies to Tarkov. It applies to everything. Mr. Powell has been saying this for years.",
    "**Today's lesson: Rest.** In music, a rest is not a mistake. It is intentional silence. Some of you should try it.",
    "**Today's lesson: Harmony.** Multiple parts working together toward one sound. If your squad cannot figure this out, that is a music problem and Mr. Powell can help.",
    "**Today's lesson: Tempo.** Staying on beat with your team. Rushing ahead causes chaos. Falling behind causes failure. This is true in music and in Tarkov.",
    "**Today's lesson: Improvisation.** Sometimes the plan falls apart and you make something up. Mr. Powell respects this, within reason.",
    "**Today's lesson: The Recorder.** Nobody asked for this lesson. It is happening anyway. Mr. Powell will not apologize.",
    "**Today's lesson: Listening.** You cannot play well if you are not listening. Mr. Powell has said this approximately 400 times. He will say it again.",
    "**Today's lesson: Knowing your role.** The triangle player does not try to be the drum. The support player does not try to be the carry. These are the same lesson.",
    "**Today's lesson: Practice.** You do not get better by accident. Mr. Powell is looking at your stats.",
    "**Today's lesson: Finishing what you start.** You do not walk off stage mid-performance. You do not leave the game mid-match. Mr. Powell has noted who does both.",
  ];

  addXP(interaction.user.id, 2);
  await interaction.reply(lessons[Math.floor(Math.random() * lessons.length)]);
}

// ─── Absent ───────────────────────────────────────────────────────────────────

async function handleAbsent(interaction) {
  const target = interaction.options.getUser('user');

  const messages = [
    `${target} was not present for class tonight. Mr. Powell has noted it. This will be on their permanent record.`,
    `Marked absent: ${target}. Mr. Powell attempted to reach them. There was no response. This is concerning.`,
    `${target} did not show up. Mr. Powell has placed a strongly worded note in their file and moved on.`,
    `${target} is absent. Mr. Powell is not surprised. He is disappointed, which is worse.`,
    `Attendance updated. ${target} is not here. Mr. Powell will be remembering this.`,
  ];

  await interaction.reply(messages[Math.floor(Math.random() * messages.length)]);
}

// ─── Powell Says ──────────────────────────────────────────────────────────────

async function handlePowellSays(interaction) {
  const quotes = [
    "The most important skill in music is listening to what the people around you are playing. I assume the same applies to whatever you are doing tonight.",
    "Practice does not make perfect. Practice makes permanent. If you keep doing something wrong, you will get permanently wrong at it. Think about that.",
    "A good musician knows when not to play. Consider this the next time you decide to push alone.",
    "I cannot teach someone who does not want to learn. I also cannot carry them. These are related thoughts.",
    "Every instrument has a role. The triangle player does not try to be the drum. Remember this.",
    "Tempo is everything. Do not rush. Do not fall behind. Stay with your team. This is music. This is also everything else.",
    "Mr. Powell once watched a student play the recorder with their nose. He has seen things. You cannot surprise him.",
    "If you make a mistake, you keep going. You do not stop in the middle of the song and explain yourself. You finish and you reflect later.",
    "Class participation is forty percent of your grade. Mr. Powell is always watching.",
    "The best performers are not always the most talented. They are the most prepared. Prepare.",
    "Mr. Powell does not play favorites. But Mr. Powell does notice who shows up and who does not.",
    "Music teaches you to fail in front of people and continue anyway. This is the most useful skill Mr. Powell has ever taught.",
  ];

  addXP(interaction.user.id, 2);
  await interaction.reply(`*"${quotes[Math.floor(Math.random() * quotes.length)]}"*\n— Mr. Powell`);
}

// ─── Beef ─────────────────────────────────────────────────────────────────────

async function handleBeef(interaction) {
  const user1 = interaction.options.getUser('user1');
  const user2 = interaction.options.getUser('user2');

  // Randomly pick a winner and a loser
  const [winner, loser] = Math.random() < 0.5 ? [user1, user2] : [user2, user1];

  const verdicts = [
    `Mr. Powell has reviewed the situation between ${user1} and ${user2}. After careful consideration, ${winner} was right. ${loser} should reflect on their behavior. This is final.`,
    `Mr. Powell heard both sides. ${loser} is the problem. ${winner} is excused. ${loser} has been added to the watchlist.`,
    `After thorough review, Mr. Powell sides with ${winner}. ${loser}'s argument was noted and dismissed. The board has been updated.`,
    `Mr. Powell does not enjoy mediating disputes. He has done it anyway. ${winner} is correct. ${loser} needs to think about what they said.`,
    `Verdict: ${winner} wins. ${loser} loses. Mr. Powell is moving on and expects everyone else to as well.`,
    `Mr. Powell listened to both sides and found ${loser} unconvincing. ${winner} may return to their seat. ${loser} may not.`,
  ];

  await interaction.reply(verdicts[Math.floor(Math.random() * verdicts.length)]);
}

// ─── Heist ────────────────────────────────────────────────────────────────────

const HEIST_SECONDS = 30;
const HEIST_XP_WIN  = 50;
const HEIST_XP_LOSE = 5;

function buildHeistEmbed(heist, resolved, success) {
  const names = [...heist.joiners.values()];

  if (!resolved) {
    return new EmbedBuilder()
      .setTitle('🔔 Bell Room Heist')
      .setDescription(
        `**${names[0]}** is planning a heist on Mr. Powell's bell room.\n` +
        `Mr. Powell is in his office grading papers. This is your chance.\n` +
        `You have **${HEIST_SECONDS} seconds** to join.`
      )
      .addFields({ name: `🦹 Crew (${names.length})`, value: names.map(n => `• ${n}`).join('\n') })
      .setColor(0xFF4500)
      .setFooter({ text: 'Success is not guaranteed. More crew helps.' });
  }

  const crewList = names.map(n => `• ${n}`).join('\n');

  if (success) {
    const lines = [
      'The crew slipped in and out. The bell is gone. Mr. Powell returned to an empty shelf and has not moved in three minutes.',
      'Flawless execution. Mr. Powell suspects nothing. The bell has been relocated. He is writing a strongly worded memo.',
      'The heist worked. Mr. Powell is filing a formal report. The crew is not yet a suspect.',
    ];
    return new EmbedBuilder()
      .setTitle('✅ Heist Successful')
      .setDescription(lines[Math.floor(Math.random() * lines.length)] + `\n\n**+${HEIST_XP_WIN} XP each.**`)
      .addFields({ name: '🦹 Crew', value: crewList })
      .setColor(0x00C851);
  }

  const lines = [
    `Mr. Powell came back early. The entire crew was caught near the instrument cabinet. Everyone has been written on the board.`,
    `Someone knocked over the triangle. Mr. Powell heard it from the hallway. Crew apprehended.`,
    `The heist failed at the last second. Mr. Powell was not in his office. He was watching. He is always watching.`,
  ];
  return new EmbedBuilder()
    .setTitle('❌ Heist Failed')
    .setDescription(lines[Math.floor(Math.random() * lines.length)] + `\n\n**+${HEIST_XP_LOSE} XP for the attempt.**`)
    .addFields({ name: '🚨 Caught', value: crewList })
    .setColor(0x808080);
}

async function resolveHeist() {
  if (!activeHeist) return;
  const heist = activeHeist;
  activeHeist = null;

  const successChance = Math.min(0.8, 0.2 + heist.joiners.size * 0.15);
  const success       = Math.random() < successChance;

  heist.joiners.forEach((_, userId) => addXP(userId, success ? HEIST_XP_WIN : HEIST_XP_LOSE));

  try {
    await heist.message.edit({ embeds: [buildHeistEmbed(heist, true, success)], components: [] });
  } catch (err) {
    console.error('Failed to resolve heist:', err);
  }
}

async function handleHeist(interaction) {
  if (activeHeist) {
    await interaction.reply({ content: 'Mr. Powell says a heist is already being planned. Wait your turn.', ephemeral: true });
    return;
  }

  activeHeist = {
    initiatorId: interaction.user.id,
    joiners:     new Map([[interaction.user.id, interaction.user.username]]),
    message:     null,
    timer:       null,
  };

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('heist_join')
      .setLabel('Join the Heist')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔔')
  );

  await interaction.reply({ embeds: [buildHeistEmbed(activeHeist, false, null)], components: [joinRow] });
  activeHeist.message = await interaction.fetchReply();
  activeHeist.timer   = setTimeout(resolveHeist, HEIST_SECONDS * 1000);
}

async function handleHeistJoin(interaction) {
  if (!activeHeist) {
    await interaction.reply({ content: 'The heist window has closed. Too slow.', ephemeral: true });
    return;
  }
  if (activeHeist.joiners.has(interaction.user.id)) {
    await interaction.reply({ content: 'Mr. Powell says you are already in this crew.', ephemeral: true });
    return;
  }

  activeHeist.joiners.set(interaction.user.id, interaction.user.username);

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('heist_join')
      .setLabel('Join the Heist')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔔')
  );

  await interaction.update({ embeds: [buildHeistEmbed(activeHeist, false, null)], components: [joinRow] });
}

// ─── Auction ──────────────────────────────────────────────────────────────────

const AUCTION_TITLES = [
  'First Chair',
  'Bell Keeper',
  'Trusted With the Instruments',
  "Teacher's Pet",
  'Front Row Privilege',
  'Class Representative',
  'Honorary Drum Major',
  'Substitute Teacher Candidate',
];

const AUCTION_SECONDS = 60;

function buildAuctionEmbed(auction, resolved) {
  if (!resolved) {
    const secondsLeft = Math.max(0, Math.ceil((auction.endsAt - Date.now()) / 1000));
    return new EmbedBuilder()
      .setTitle('🏷️ Class Title Auction')
      .setDescription(
        `Mr. Powell is auctioning the title of **"${auction.title}"**.\n` +
        `Highest bidder wins. Bids come out of your actual XP.\n` +
        `Auction closes in **${secondsLeft}s**.`
      )
      .addFields({
        name:  'Current Bid',
        value: auction.topBid > 0
          ? `**${auction.topBid} XP** — ${auction.topBidderName}`
          : 'No bids yet — starting at 1 XP',
      })
      .setColor(0xFFD700)
      .setFooter({ text: 'Mr. Powell will record the winner in the gradebook.' });
  }

  if (!auction.topBidderId) {
    return new EmbedBuilder()
      .setTitle('🏷️ Auction Closed — No Bids')
      .setDescription(`Nobody bid on **"${auction.title}"**. Mr. Powell is unsurprised. The title goes unclaimed.`)
      .setColor(0x808080);
  }

  return new EmbedBuilder()
    .setTitle('🏷️ Auction Closed')
    .setDescription(
      `**${auction.topBidderName}** has won the title of **"${auction.title}"** for **${auction.topBid} XP**.\n` +
      `Mr. Powell has updated the gradebook. The title is now official.`
    )
    .setColor(0xFFD700);
}

async function resolveAuction() {
  if (!activeAuction) return;
  const auction = activeAuction;
  activeAuction = null;

  if (auction.topBidderId) addXP(auction.topBidderId, -auction.topBid);

  try {
    await auction.message.edit({ embeds: [buildAuctionEmbed(auction, true)], components: [] });
  } catch (err) {
    console.error('Failed to resolve auction:', err);
  }
}

async function handleAuction(interaction) {
  if (activeAuction) {
    await interaction.reply({ content: 'Mr. Powell says an auction is already in progress.', ephemeral: true });
    return;
  }

  const title = AUCTION_TITLES[Math.floor(Math.random() * AUCTION_TITLES.length)];

  activeAuction = {
    title,
    topBid:        0,
    topBidderId:   null,
    topBidderName: null,
    endsAt:        Date.now() + AUCTION_SECONDS * 1000,
    message:       null,
    timer:         null,
  };

  const bidRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('auction_bid_btn')
      .setLabel('Place a Bid')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('💰')
  );

  await interaction.reply({ embeds: [buildAuctionEmbed(activeAuction, false)], components: [bidRow] });
  activeAuction.message = await interaction.fetchReply();
  activeAuction.timer   = setTimeout(resolveAuction, AUCTION_SECONDS * 1000);
}

async function handleAuctionBidButton(interaction) {
  if (!activeAuction) {
    await interaction.reply({ content: 'The auction has already closed.', ephemeral: true });
    return;
  }

  const userXP = getXP(interaction.user.id);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('auction_bid_modal')
      .setTitle(`Bid on: ${activeAuction.title}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bid_amount')
            .setLabel(`Your XP: ${userXP} | Current bid: ${activeAuction.topBid}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(6)
            .setPlaceholder(`Enter more than ${activeAuction.topBid}`)
        )
      )
  );
}

async function handleAuctionBidModal(interaction) {
  if (!activeAuction) {
    await interaction.reply({ content: 'The auction closed while you were typing. Bad timing.', ephemeral: true });
    return;
  }

  const amount = parseInt(interaction.fields.getTextInputValue('bid_amount'), 10);
  const userXP = getXP(interaction.user.id);

  if (isNaN(amount) || amount <= 0) {
    await interaction.reply({ content: 'Mr. Powell says that is not a valid bid.', ephemeral: true });
    return;
  }
  if (amount > userXP) {
    await interaction.reply({ content: `You only have **${userXP} XP**. You cannot bid **${amount}**.`, ephemeral: true });
    return;
  }
  if (amount <= activeAuction.topBid) {
    await interaction.reply({ content: `Your bid of **${amount} XP** does not beat the current bid of **${activeAuction.topBid} XP**. Bid higher.`, ephemeral: true });
    return;
  }

  activeAuction.topBid        = amount;
  activeAuction.topBidderId   = interaction.user.id;
  activeAuction.topBidderName = interaction.user.username;

  await interaction.reply({
    content:   `Your bid of **${amount} XP** is accepted. You are currently winning **"${activeAuction.title}"**.`,
    ephemeral: true,
  });

  const bidRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('auction_bid_btn')
      .setLabel('Place a Bid')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('💰')
  );

  try {
    await activeAuction.message.edit({ embeds: [buildAuctionEmbed(activeAuction, false)], components: [bidRow] });
  } catch (err) {
    console.error('Failed to update auction message:', err);
  }
}

// ─── Music Test ───────────────────────────────────────────────────────────────

const QUIZ_QUESTIONS = [
  { question: 'What does "forte" mean in music?',                                               options: ['Soft', 'Loud', 'Fast', 'Slow'],                                                        correct: 1 },
  { question: 'How many strings does a standard guitar have?',                                  options: ['4', '5', '6', '7'],                                                                   correct: 2 },
  { question: 'What is a musical "rest"?',                                                      options: ['A type of chord', 'A silence between notes', 'A time signature', 'A key change'],    correct: 1 },
  { question: 'What does "piano" mean as a dynamic marking?',                                   options: ['Fast', 'Loud', 'Soft', 'Slow'],                                                       correct: 2 },
  { question: 'How many beats are in a measure of 4/4 time?',                                   options: ['2', '3', '4', '8'],                                                                   correct: 2 },
  { question: 'What does "crescendo" mean?',                                                    options: ['Gradually louder', 'Gradually softer', 'Suddenly loud', 'Suddenly soft'],             correct: 0 },
  { question: 'How many lines are on a standard musical staff?',                                options: ['3', '4', '5', '6'],                                                                   correct: 2 },
  { question: 'What tempo is "Allegro"?',                                                       options: ['Very slow', 'Moderate', 'Fast', 'Very fast'],                                         correct: 2 },
  { question: 'What is the highest standard vocal range?',                                      options: ['Alto', 'Tenor', 'Soprano', 'Bass'],                                                   correct: 2 },
  { question: 'What does "mezzo-forte" mean?',                                                  options: ['Very soft', 'Moderately loud', 'Very loud', 'Moderately soft'],                       correct: 1 },
  { question: 'What is the lowest-pitched brass instrument?',                                   options: ['Trumpet', 'Trombone', 'French Horn', 'Tuba'],                                         correct: 3 },
  { question: 'What does "banaga" mean according to Mr. Powell?',                               options: ['A rhythm style', 'A type of instrument', 'Mr. Powell does not know', 'A key signature'], correct: 2 },
  { question: 'Which instrument is Mr. Powell most likely to confiscate?',                      options: ['The violin', 'The recorder', 'The triangle', 'The xylophone'],                        correct: 1 },
  { question: 'According to Mr. Powell, which instrument should not try to be the drum?',       options: ['The guitar', 'The flute', 'The triangle', 'The bass'],                                correct: 2 },
  { question: 'What percentage of your grade is class participation, according to Mr. Powell?', options: ['10%', '20%', '30%', '40%'],                                                           correct: 3 },
];

const QUIZ_SECONDS  = 30;
const QUIZ_XP_WIN   = 20;
const QUIZ_XP_WRONG = -5;

function buildQuizEmbed(quiz, winnerName, expired) {
  const labels      = ['A', 'B', 'C', 'D'];
  const optionLines = quiz.options.map((opt, i) => `**${labels[i]}.** ${opt}`).join('\n');

  if (expired) {
    return new EmbedBuilder()
      .setTitle('📝 Pop Quiz — Time\'s Up')
      .setDescription(
        `Nobody answered correctly in time.\n` +
        `The answer was **${labels[quiz.correctIndex]}. ${quiz.options[quiz.correctIndex]}**.\n` +
        `Mr. Powell is not impressed.`
      )
      .setColor(0x808080);
  }

  if (winnerName) {
    return new EmbedBuilder()
      .setTitle('📝 Correct!')
      .setDescription(
        `**${winnerName}** got it right.\n\n` +
        `**${quiz.question}**\n\n${optionLines}\n\n` +
        `✅ **${labels[quiz.correctIndex]}. ${quiz.options[quiz.correctIndex]}** — **+${QUIZ_XP_WIN} XP**`
      )
      .setColor(0x00C851);
  }

  return new EmbedBuilder()
    .setTitle('📝 Mr. Powell\'s Pop Quiz')
    .setDescription(`**${quiz.question}**\n\n${optionLines}`)
    .setColor(0x5865F2)
    .setFooter({ text: `First correct answer: +${QUIZ_XP_WIN} XP. Wrong answer: ${QUIZ_XP_WRONG} XP. ${QUIZ_SECONDS} seconds.` });
}

function buildQuizRow() {
  return new ActionRowBuilder().addComponents(
    ...['A', 'B', 'C', 'D'].map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`quiz_answer__${i}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
    )
  );
}

async function handleMusicTest(interaction) {
  if (activeQuiz) {
    await interaction.reply({ content: 'Mr. Powell says a quiz is already in session. Pay attention.', ephemeral: true });
    return;
  }

  const q = QUIZ_QUESTIONS[Math.floor(Math.random() * QUIZ_QUESTIONS.length)];

  activeQuiz = {
    question:     q.question,
    options:      q.options,
    correctIndex: q.correct,
    message:      null,
    timer:        null,
  };

  await interaction.reply({ embeds: [buildQuizEmbed(activeQuiz, null, false)], components: [buildQuizRow()] });
  activeQuiz.message = await interaction.fetchReply();

  activeQuiz.timer = setTimeout(async () => {
    if (!activeQuiz) return;
    const quiz = activeQuiz;
    activeQuiz = null;
    try {
      await quiz.message.edit({ embeds: [buildQuizEmbed(quiz, null, true)], components: [] });
    } catch (err) {
      console.error('Failed to expire quiz:', err);
    }
  }, QUIZ_SECONDS * 1000);
}

async function handleQuizAnswer(interaction) {
  if (!activeQuiz) {
    await interaction.reply({ content: 'No active quiz.', ephemeral: true });
    return;
  }

  const optionIndex = parseInt(interaction.customId.split('__')[1], 10);

  if (optionIndex === activeQuiz.correctIndex) {
    clearTimeout(activeQuiz.timer);
    const quiz = activeQuiz;
    activeQuiz = null;
    addXP(interaction.user.id, QUIZ_XP_WIN);
    await interaction.update({ embeds: [buildQuizEmbed(quiz, interaction.user.username, false)], components: [] });
  } else {
    addXP(interaction.user.id, QUIZ_XP_WRONG);
    await interaction.reply({ content: `Wrong. Mr. Powell has noted your answer. **${QUIZ_XP_WRONG} XP.**`, ephemeral: true });
  }
}

// ─── Duel ─────────────────────────────────────────────────────────────────────

const DUEL_STAKE   = 20;
const DUEL_SECONDS = 30;

const DUEL_ROUNDS = [
  'Recorder Showdown', 'Rhythm Battle', 'Music Theory Quiz',
  'Sight-Reading Test', 'Instrument Assembly Speed Run',
  'Triangle Solo', 'Air Guitar Competition', 'Metronome Challenge',
  'Tambourine Duel', 'Name That Tune',
];

async function handleDuel(interaction) {
  const challenger = interaction.user;
  const target     = interaction.options.getUser('user');

  if (target.id === challenger.id) {
    await interaction.reply({ content: 'Mr. Powell says you cannot duel yourself. Sit down.', ephemeral: true });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: 'Mr. Powell says you cannot duel a bot. That is not a real student.', ephemeral: true });
    return;
  }
  if (activeDuels.has(challenger.id)) {
    await interaction.reply({ content: 'You already have a pending duel. Resolve it first.', ephemeral: true });
    return;
  }

  activeDuels.set(challenger.id, {
    challengerId:   challenger.id,
    challengerName: challenger.username,
    targetId:       target.id,
    targetName:     target.username,
    message:        null,
    timer:          null,
  });

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Duel Challenge')
    .setDescription(
      `${challenger} has challenged ${target} to a duel.\n` +
      `**Stake: ${DUEL_STAKE} XP**\n\n` +
      `${target}, you have ${DUEL_SECONDS} seconds to accept.\n` +
      `Mr. Powell will oversee this. He did not ask for this responsibility.`
    )
    .setColor(0xFF4500);

  const acceptRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`duel_accept__${challenger.id}`)
      .setLabel('Accept the Duel')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⚔️')
  );

  await interaction.reply({ embeds: [embed], components: [acceptRow] });
  const message = await interaction.fetchReply();
  activeDuels.get(challenger.id).message = message;

  activeDuels.get(challenger.id).timer = setTimeout(async () => {
    if (!activeDuels.has(challenger.id)) return;
    activeDuels.delete(challenger.id);
    try {
      await message.edit({
        embeds: [new EmbedBuilder()
          .setTitle('⚔️ Duel Expired')
          .setDescription(`${target} did not respond in time. Mr. Powell has noted the cowardice. Duel cancelled.`)
          .setColor(0x808080)],
        components: [],
      });
    } catch (err) {
      console.error('Failed to expire duel:', err);
    }
  }, DUEL_SECONDS * 1000);
}

async function handleDuelAccept(interaction) {
  const challengerId = interaction.customId.split('__')[1];
  const duel         = activeDuels.get(challengerId);

  if (!duel) {
    await interaction.reply({ content: 'This duel has already expired.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== duel.targetId) {
    await interaction.reply({ content: 'Mr. Powell says this duel is not yours to accept.', ephemeral: true });
    return;
  }

  clearTimeout(duel.timer);
  activeDuels.delete(challengerId);

  const rounds       = [...DUEL_ROUNDS].sort(() => Math.random() - 0.5).slice(0, 3);
  let challengerWins = 0;
  let targetWins     = 0;

  const roundResults = rounds.map(name => {
    const challengerWon = Math.random() < 0.5;
    if (challengerWon) challengerWins++;
    else               targetWins++;
    return `**${name}:** ${challengerWon ? duel.challengerName : duel.targetName} wins`;
  });

  const challengerWon = challengerWins > targetWins;
  const winnerId      = challengerWon ? duel.challengerId : duel.targetId;
  const loserId       = challengerWon ? duel.targetId    : duel.challengerId;
  const winnerName    = challengerWon ? duel.challengerName : duel.targetName;
  const loserName     = challengerWon ? duel.targetName    : duel.challengerName;

  addXP(winnerId,  DUEL_STAKE);
  addXP(loserId,  -DUEL_STAKE);

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Duel Complete')
    .setDescription(
      `Mr. Powell presided over the duel. The results are final.\n\n` +
      roundResults.join('\n') + `\n\n` +
      `**${winnerName}** wins **${DUEL_STAKE} XP** from **${loserName}**.`
    )
    .setColor(0xFFD700)
    .setFooter({ text: `Score: ${challengerWins}-${targetWins} | Mr. Powell is filing this in the gradebook.` });

  await interaction.update({ embeds: [embed], components: [] });
}

// ─── Express Web Server ───────────────────────────────────────────────────────

const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.get('/', (_req, res) => res.send('Mr. Powell is awake.'));

app.listen(PORT, () => console.log(`Web server listening on port ${PORT}.`));

// ─── Login ────────────────────────────────────────────────────────────────────

console.log('Attempting Discord login...');

client.login(TOKEN)
  .then(() => console.log('Discord login request succeeded.'))
  .catch(error => {
    console.error('Failed to log into Discord:', error);
    console.error('The bot will stay running so Render does not restart and worsen any rate limit.');
  });
