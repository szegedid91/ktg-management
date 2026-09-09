// Feladatok — partnernek helyszín szerint csoportosítva, munkavállalónak a
// sajátjai állapot szerint.

import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Btn, Sub } from '../ui/kit';
import { useTable } from '../lib/hooks';
import { getCurrentUserId } from '../lib/repo';
import { WorkerTaskList } from '../components/WorkerTaskList';
import { TaskBoard } from '../components/TaskBoard';
import { WorkerTask, TaskAssignee, Profile } from '../lib/types';

export default function Tasks() {
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const profiles = useTable<Profile>('profiles');
  const me = getCurrentUserId();
  const myWorkerId = profiles.find((p) => p.id === me)?.worker_id ?? null;

  if (myWorkerId) {
    const mine = tasks.filter((t) => assignees.some((a) => a.task_id === t.id && a.worker_id === myWorkerId));
    return (
      <Screen>
        <Sub>A neked kiadott feladatok.</Sub>
        <WorkerTaskList tasks={mine} showClosed />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Sub>Szűrj állapotra, helyszínre, emberre — vagy keress.</Sub>
        <Btn title="+ Feladat" kind="secondary" small onPress={() => router.push('/task/new')} />
      </View>
      <TaskBoard tasks={tasks} includeClosed />
    </Screen>
  );
}
