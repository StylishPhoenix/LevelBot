function getLeaderboardData(user) {
  const query = `
    SELECT user_id, SUM(points) as points
    FROM point_history
    WHERE user_id = ?
    GROUP BY user_id, house
    ORDER BY points DESC
  `;

  const stmt = db.prepare(query);
  const rows = stmt.all(user);
  return rows;
}

async function logPoints(userId, points, reason) {
  const timestamp = Date.now();
  if (points == 0) return;
  db.prepare(`INSERT INTO point_history (user_id, points, reason, timestamp) VALUES (?, ?, ?, ?, ?)`).run(userId, points, reason, timestamp);
}

async function displayLeaderboard(interaction, client, currentPage) {
    // Retrieve the leaderboard data from the database
  const leaderboardData = await getLeaderboardData(user.id);

  // Sort the data in decreasing order of points contributed
  leaderboardData.sort((a, b) => b.points - a.points);
  const limit = 10;
  const totalPages = Math.ceil(leaderboardData.length / limit);
  const startIndex = currentPage * limit;
  const footer = { text: `Page ${currentPage + 1} of ${totalPages}` };
  const userID = interaction.user.id;
  // Format the leaderboard data
  const splitLeaderboardPromises = leaderboardData
    .slice(startIndex, startIndex + limit)
    .map(async (entry, index) => {
      const user = await client.users.fetch(entry.user_id);
      return `${index + 1 + startIndex}. User: ${user}, Points: ${entry.points}`;
    });
  const splitLeaderboard = await Promise.all(splitLeaderboardPromises);
  const formattedLeaderboard = splitLeaderboard.join('\n\n');

  // Create the embed
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`Misfits Leaderboard`)
    .setDescription(formattedLeaderboard)
    .setFooter(footer);

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_prev_${currentPage}_${totalPages}_${userID}`)
        .setLabel('Previous')
        .setStyle('1')
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`leaderboard_next_${currentPage}_${totalPages}_${userID}`)
        .setLabel('Next')
        .setStyle('1')
        .setDisabled(currentPage === totalPages - 1)
    );

  // Send the embed as a reply
  return { embeds: [embed], components: [row] };
}

function calculatePoints(userId, message) {
  const now = Date.now(); 
  const pointsPerMessage = [25, 20, 15, 10, 10, 5, 5, 5, 5];

  if (!userPointsData.hasOwnProperty(userId)) {
    userPointsData[userId] = {
      lastMessageTimestamp: Date.now() - 60000,
      points: 0,
      messagesInCurrentInterval: 0,
      pointsScheduled: false,
    };
  }
  if (message.length < 10) {
    userPointsData[userId].lastMessageTimestamp = now;
    return;
  }
  const elapsedTime = now - userPointsData[userId].lastMessageTimestamp;
  if (elapsedTime < 30000) { //The minimum interval between messages.  If the user spams out a bunch, the system will update the time of their last message in order to prevent attempts to spam until they are rewarded.
    userPointsData[userId].lastMessageTimestamp = now;
    return;
  }

  if (userPointsData[userId].messagesInCurrentInterval === 0) {
    userPointsData[userId].points += pointsPerMessage[userPointsData[userId].messagesInCurrentInterval];
  } else {
    userPointsData[userId].points += pointsPerMessage[userPointsData[userId].messagesInCurrentInterval] || 0;
  }

  userPointsData[userId].messagesInCurrentInterval++;

  // Update the lastMessageTimestamp after processing the message.
  userPointsData[userId].lastMessageTimestamp = now;

  if (userPointsData[userId].points > 100) {
    userPointsData[userId].points = 100;
  }
  // Schedule the addition of points every hour
  if (!userPointsData[userId].pointsScheduled) {
    scheduleAddPoints(userId);
  }
}

function scheduleAddPoints(userId) {
  userPointsData[userId].pointsScheduled = true;
  setTimeout(() => {
    const earnedPoints = userPointsData[userId].points;
    userPointsData[userId].points = 0;
    userPointsData[userId].messagesInCurrentInterval = 0;
    logPoints(userId, earnedPoints, 'Chat Messages');
    userPointsData[userId].pointsScheduled = false;
  }, 3600000); // 1 hour in milliseconds
}

async function updateVoiceChannelPoints(guild, client) {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id;
    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    if (oldChannel !== newChannel || oldState.mute !== newState.mute || oldState.deaf !== newState.deaf) {
      if (oldChannel) {
        // User left a voice channel or switched to another channel
          const startTime = userVoiceTimes[userId];
          const currentTime = Date.now();
		
	 if (startTime && !isNaN(startTime)) { // Check if startTime is valid
          const timeSpent = currentTime - startTime;

          // Calculate points based on time spent in the voice channel
          const points = Math.floor(timeSpent / timeInterval) * pointsPerInterval;

          // Add points and log them
          await logPoints(userId, points, 'Voice Channel Points');
	 }
          // Remove the user's entry from userVoiceTimes
          delete userVoiceTimes[userId];
        }

      if (newChannel) {
        // User joined a voice channel
        const humanMembers = newChannel.members.filter(member => !member.user.bot && !member.voice.mute && !member.voice.deaf);
        if (humanMembers.size >= minimumVoice) {
          userVoiceTimes[userId] = Date.now();
        }
      }
    }
  });
}

async function createPaginatedEmbed(client, interaction, targetType, targetId, currentPage) {
  const limit = 10;
  const pointHistoryArray = await pointHistory(db, targetType, targetId);
  const totalPages = Math.ceil(pointHistoryArray.length / limit);
  const startIndex = currentPage * limit;
  const userID = interaction.user.id;
  const footer = { text: `Page ${currentPage + 1} of ${totalPages}` };
  const formattedHistory = await Promise.all(pointHistoryArray
    .slice(startIndex, startIndex + limit)
    .map( async (entry, index) => {
	  const user = await client.users.fetch(entry.user_id);
      return `${index + 1 + startIndex}. User: ${user}, Points: ${entry.points}, Timestamp: ${new Date(entry.timestamp).toLocaleString()}, Reason: ${entry.reason}`;
    }));
	const joinedHistory = formattedHistory.join('\n\n');

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('Point History')
	.setFooter(footer)
    .setDescription(joinedHistory);

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`paginate_prev_${currentPage}_${totalPages}_${targetType}_${targetId}_${userID}`)
        .setLabel('Previous')
        .setStyle('1')
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`paginate_next_${currentPage}_${totalPages}_${targetType}_${targetId}_${userID}`)
        .setLabel('Next')
        .setStyle('1')
        .setDisabled(currentPage === totalPages - 1)
    );

  return { embeds: [embed], components: [row] };
}

async function pointHistory(db, targetType, targetId) {
  return new Promise((resolve, reject) => {
    let query = '';
    if (targetType === 'user') {
      query = `SELECT * FROM point_history WHERE user_id = ? ORDER BY timestamp DESC`;
    } else {
      reject(new Error('Invalid targetType'));
      return;
    }
    
    const rows = db.prepare(query).all(targetId);
    resolve(rows);
  });
}

client.login(token);