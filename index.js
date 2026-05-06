require('dotenv').config();

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

const TOKEN = process.env.TOKEN;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!process.env.TOKEN) {
  console.error('ERROR: TOKEN environment variable is missing. The bot cannot start.');
  process.exit(1);
}

// ─── Client Setup ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Active bell games stored in memory while the bot is running.
// Key: userId  |  Value: { target, guesses, maxGuesses }
const activeGames = new Map();

// ─── Slash Command Definitions ────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('findthebell')
    .setDescription('Mr. Powell hid the bell somewhere between 1 and 100. Find it.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('discipline')
    .setDescription('Mr. Powell disciplines a student.')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The student to discipline')
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Mr. Powell welcomes the class to Made New.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription("Check a student's music class level.")
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The student to check (defaults to you)')
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('banaga')
    .setDescription('...')
    .toJSON(),
];

// ─── Error Listeners ─────────────────────────────────────────────────────────

client.on('error', error => {
  console.error('Discord client error:', error);
});

client.on('shardError', error => {
  console.error('Discord shard error:', error);
});

// ─── Ready Event ──────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}.`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('Registering slash commands globally...');

    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );

    console.log('Slash commands registered. Class is now in session.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

// ─── New Member Welcome ───────────────────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
  if (!WELCOME_CHANNEL_ID) {
    console.error('WELCOME_CHANNEL_ID is missing from .env. Cannot send welcome message.');
    return;
  }

  const welcomeMessages = [
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

    if (!channel || !channel.isTextBased()) {
      console.error(`Welcome channel (ID: ${WELCOME_CHANNEL_ID}) was not found or is not a text channel.`);
      return;
    }

    const randomMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
    await channel.send(randomMessage);
  } catch (error) {
    console.error('Failed to send welcome message:', error);
  }
});

// ─── Interaction Router ───────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  // Modal submission (guess input from the bell game)
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('bell_guess_modal__')) {
      await handleBellGuessModal(interaction);
    }
    return;
  }

  // Button clicks
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('bell_guess_btn__')) {
      await handleBellGuessButton(interaction);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'findthebell': await handleFindTheBell(interaction); break;
    case 'discipline':  await handleDiscipline(interaction);  break;
    case 'welcome':     await handleWelcome(interaction);     break;
    case 'level':       await handleLevel(interaction);       break;
    case 'banaga':      await handleBanaga(interaction);      break;
  }
});

// ─── Bell Game Helpers ────────────────────────────────────────────────────────

// Returns heat info based on how far the guess is from the target.
function getHeat(distance) {
  if (distance === 0)  return { label: '🔔 FOUND IT',    bar: '🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔', color: 0xFFD700 };
  if (distance <= 3)   return { label: '🔥 SCORCHING',   bar: '🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥', color: 0xFF0000 };
  if (distance <= 8)   return { label: '🔥 BURNING',     bar: '🟥🟥🟥🟥🟥🟥🟥🟧🟧🟧', color: 0xFF4500 };
  if (distance <= 15)  return { label: '♨️ VERY WARM',   bar: '🟧🟧🟧🟧🟧🟧🟧🟦🟦🟦', color: 0xFF8C00 };
  if (distance <= 25)  return { label: '🌡️ WARM',        bar: '🟨🟨🟨🟨🟨🟨🟦🟦🟦🟦', color: 0xFFD700 };
  if (distance <= 40)  return { label: '❄️ COLD',        bar: '🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦', color: 0x4169E1 };
  return                      { label: '🧊 ICE COLD',    bar: '🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵', color: 0x00BFFF };
}

// Builds the embed shown for every state of the game.
function buildBellEmbed(user, guesses, lastHeat, maxGuesses, won, lost, target) {
  const guessesLeft = maxGuesses - guesses.length;

  let title, description, color, bar;

  if (won) {
    title       = '🔔  Bell Found!';
    description = `${user} found the bell in **${guesses.length}** guess${guesses.length !== 1 ? 'es' : ''}.\nMr. Powell is speechless. Class may continue.`;
    color       = 0xFFD700;
    bar         = '🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔';
  } else if (lost) {
    title       = '💀  Game Over';
    description = `${user} ran out of guesses. The bell was at **${target}**.\nMr. Powell is deeply disappointed. The whole class loses recess.`;
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
    .addFields({ name: '🎵  Music Volume', value: bar, inline: false });

  // Guess history with warmer / colder arrows
  if (guesses.length > 0) {
    const lines = guesses.map((g, i) => {
      let arrow = '';
      if (i > 0) {
        const prev = Math.abs(guesses[i - 1].number - target);
        const curr = Math.abs(g.number - target);
        if (curr < prev)      arrow = '  📈 warmer';
        else if (curr > prev) arrow = '  📉 colder';
        else                  arrow = '  ↔️ same';
      }
      return `**${g.number}** → ${g.heat}${arrow}`;
    });

    embed.addFields({ name: '📋  Guess History', value: lines.join('\n'), inline: false });
  }

  if (!won && !lost) {
    embed.addFields({ name: '🎯  Guesses Left', value: `${guessesLeft} of ${maxGuesses}`, inline: false });
    embed.setFooter({ text: 'Click Make a Guess and enter a number between 1 and 100.' });
  }

  return embed;
}

// The single "Make a Guess" button.
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

// ─── Bell Game Command Handlers ───────────────────────────────────────────────

// /findthebell — starts a new game
async function handleFindTheBell(interaction) {
  if (activeGames.has(interaction.user.id)) {
    await interaction.reply({
      content: 'Mr. Powell says you already have an active game. Finish it before starting another.',
      ephemeral: true,
    });
    return;
  }

  const target = Math.floor(Math.random() * 100) + 1;
  activeGames.set(interaction.user.id, { target, guesses: [], maxGuesses: 7 });

  const embed = buildBellEmbed(interaction.user, [], null, 7, false, false, target);

  await interaction.reply({
    embeds: [embed],
    components: [buildGuessButton(interaction.user.id)],
  });
}

// Button click — shows the modal so the user can type a number
async function handleBellGuessButton(interaction) {
  const userId = interaction.customId.split('__')[1];

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: 'Mr. Powell says this is not your game to play.',
      ephemeral: true,
    });
    return;
  }

  const game = activeGames.get(userId);
  if (!game) {
    await interaction.reply({
      content: 'No active game found. Use /findthebell to start one.',
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
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
    );

  await interaction.showModal(modal);
}

// Modal submitted — process the guess and update the embed
async function handleBellGuessModal(interaction) {
  const userId = interaction.customId.split('__')[1];
  const game   = activeGames.get(userId);

  if (!game) {
    await interaction.reply({ content: 'No active game found. Use /findthebell to start one.', ephemeral: true });
    return;
  }

  const input = interaction.fields.getTextInputValue('guess_input');
  const guess = parseInt(input, 10);

  if (isNaN(guess) || guess < 1 || guess > 100) {
    await interaction.reply({
      content: 'Mr. Powell says that is not valid. Enter a whole number between 1 and 100.',
      ephemeral: true,
    });
    return;
  }

  const distance = Math.abs(guess - game.target);
  const heat     = getHeat(distance);

  game.guesses.push({ number: guess, heat: heat.label });

  const won  = distance === 0;
  const lost = !won && game.guesses.length >= game.maxGuesses;

  if (won || lost) activeGames.delete(userId);

  const embed      = buildBellEmbed(interaction.user, game.guesses, heat, game.maxGuesses, won, lost, game.target);
  const components = (won || lost) ? [] : [buildGuessButton(userId)];

  await interaction.update({ embeds: [embed], components });
}

// ─── Other Command Handlers ───────────────────────────────────────────────────

async function handleDiscipline(interaction) {
  const targetUser = interaction.options.getUser('user');

  const messages = [
    `${targetUser} has been moved to the front row.`,
    `Mr. Powell wrote ${targetUser}'s name on the board.`,
    `${targetUser} has lost instrument privileges.`,
    `Mr. Powell is silently waiting for ${targetUser} to stop talking.`,
    `${targetUser} has been separated from the group.`,
    `${targetUser} is no longer trusted with the tambourine.`,
    `${targetUser} has been caught talking during music time.`,
    `${targetUser} must now sit where Mr. Powell can see them.`,
  ];

  await interaction.reply(messages[Math.floor(Math.random() * messages.length)]);
}

async function handleWelcome(interaction) {
  await interaction.reply(
    "Welcome to Made New. Mr. Powell has taken attendance. Keep your hands to yourself, don't touch the instruments without permission, and join VC when instructed."
  );
}

async function handleLevel(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;

  // Levels are random for now.
  // To add real XP tracking later, replace the random pick with a database
  // lookup keyed on targetUser.id and calculate the level from stored XP.
  const levels = [
    { number: 1,  title: 'Sitting on the Carpet'        },
    { number: 2,  title: 'Reluctant Participant'         },
    { number: 3,  title: 'Triangle Holder'               },
    { number: 4,  title: 'Drum Circle Member'            },
    { number: 5,  title: 'Bell Finder'                   },
    { number: 6,  title: 'Front Row Survivor'            },
    { number: 7,  title: 'Trusted With the Instruments'  },
    { number: 8,  title: "Teacher's Favorite"            },
    { number: 9,  title: 'Music Room Legend'             },
    { number: 10, title: "Mr. Powell's Successor"        },
  ];

  const randomLevel = levels[Math.floor(Math.random() * levels.length)];

  await interaction.reply(
    `${targetUser} is currently **Level ${randomLevel.number}: ${randomLevel.title}**.`
  );
}

async function handleBanaga(interaction) {
  const messages = [
    'Mr. Powell heard banaga and stopped the entire lesson.',
    'Banaga has been added to the lesson plan.',
    'Mr. Powell does not know what banaga means, but he is concerned.',
    'The class said banaga too many times. Everyone lost music privileges.',
    'Banaga detected. Recorder test postponed.',
    'Someone said banaga and now Mr. Powell is standing silently at the front of the room.',
    'Banaga has been reported to the principal.',
  ];

  await interaction.reply(messages[Math.floor(Math.random() * messages.length)]);
}

// ─── Express Web Server ───────────────────────────────────────────────────────

const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('Mr. Powell is awake.');
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}.`);
});

// ─── Login ────────────────────────────────────────────────────────────────────

console.log('Attempting Discord login...');

client.login(TOKEN)
  .then(() => {
    console.log('Discord login request succeeded.');
  })
  .catch(error => {
    console.error('Failed to log into Discord:', error);
    console.error('The bot will stay running so Render does not restart and worsen any rate limit.');
  });
