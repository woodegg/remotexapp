"""Real Linux process ownership checks for the long-run resource sampler."""
import contextlib
import json
import subprocess
import sys
import tempfile
import time
import unittest

from process_resources import ProcessFamily, arguments, role


class ProcessResourcesTest(unittest.TestCase):
    def test_detached_companion_requires_both_handler_name_and_private_marker(self):
        # A detached handler is not a descendant of Chrome. Including every
        # same-UID handler would also include unrelated browser profiles.
        processes = []
        with tempfile.TemporaryDirectory(prefix='rx-resource-owner-') as marker:
            try:
                for executable, extra in [
                        ('owned-root', 'owned-resource-root'),
                        ('/owned/chrome_crashpad_handler', '--database=' + marker),
                        ('/owned/chrome_crashpad_handler', '--database=/unrelated-profile'),
                        ('/owned/unrelated-handler', '--database=' + marker)]:
                    processes.append(subprocess.Popen(
                        [executable, '-c', 'import time;time.sleep(20)', extra],
                        executable=sys.executable))
                root, selected, unrelated, wrong_name = processes
                family = ProcessFamily(root.pid, root_argument='owned-resource-root',
                                       detached_marker=marker)
                sample = family.sample()
                self.assertTrue(sample['completeStableFamily'], sample)
                self.assertEqual({row['pid'] for row in sample['processes']},
                                 {root.pid, selected.pid})
                self.assertNotIn(unrelated.pid, family.members())
                self.assertNotIn(wrong_name.pid, family.members())
                self.assertEqual(next(row['role'] for row in sample['processes']
                                      if row['pid'] == selected.pid), 'crashpad')
            finally:
                for process in processes:
                    process.terminate()
                    process.wait(timeout=3)

    def test_chrome_process_title_preserves_renderer_and_utility_roles(self):
        # Exercise the actual Linux argv[0] form, not a mocked /proc record.
        title = '/opt/google/chrome/chrome --type=utility --utility-sub-type=audio.mojom.AudioService'
        process = subprocess.Popen([title], executable='/bin/cat',
                                   stdin=subprocess.PIPE, stdout=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 2
            args = arguments(process.pid)
            while not args and process.poll() is None and time.monotonic() < deadline:
                time.sleep(.01)
                args = arguments(process.pid)
            self.assertEqual(args[0], '/opt/google/chrome/chrome')
            self.assertEqual(role(args),
                             'utility:audio.mojom.AudioService')
            self.assertEqual(role(['/opt/google/chrome/chrome', '--type=renderer']),
                             'renderer')
        finally:
            process.stdin.close()
            process.terminate()
            process.wait(timeout=3)

    def test_family_includes_real_child_but_excludes_sibling_and_rejects_wrong_identity(self):
        # Both children are owned by this test. Only the child of the qualified
        # root belongs to its measured family, even though all share a UID.
        program = '''import subprocess,sys,json,time
child=subprocess.Popen([sys.executable,'-c','import time;data=bytearray(12*1024*1024);time.sleep(20)'])
print(json.dumps({'child':child.pid}),flush=True)
try:sys.stdin.read()
finally:child.terminate();child.wait(timeout=3)
'''
        root = subprocess.Popen([sys.executable, '-u', '-c', program, 'owned-resource-root'],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        sibling = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(20)'])
        try:
            child = json.loads(root.stdout.readline())['child']
            family = ProcessFamily(root.pid, root_argument='owned-resource-root')
            sample = family.sample()
            self.assertTrue(sample['completeStableFamily'], sample)
            self.assertEqual({row['pid'] for row in sample['processes']}, {root.pid, child})
            self.assertNotIn(sibling.pid, family.members())
            self.assertGreater(sample['totalsKiB']['Pss_Anon'], 0)
            self.assertEqual(sample['totalsKiB']['PssAnonPlusSwapPss'],
                             sample['totalsKiB']['Pss_Anon'] + sample['totalsKiB']['SwapPss'])
            with self.assertRaisesRegex(RuntimeError, 'command-line'):
                ProcessFamily(root.pid, root_argument='unrelated-resource-root')
            family.root['startTicks'] += 1
            with self.assertRaisesRegex(RuntimeError, 'identity'):
                family.sample()
        finally:
            root.stdin.close()
            with contextlib.suppress(subprocess.TimeoutExpired):
                root.wait(timeout=5)
            if root.poll() is None:
                root.kill()
                root.wait(timeout=3)
            root.stdout.close()
            sibling.terminate()
            sibling.wait(timeout=3)


if __name__ == '__main__':
    unittest.main()
